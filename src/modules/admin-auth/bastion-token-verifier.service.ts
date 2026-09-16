import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface BastionJwtPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  username?: string;
  image?: string;
  preferredLocale?: string;
  appSlug: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}

interface JwksCache {
  keys: crypto.KeyObject[];
  expiresAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Verifies Bastion-issued RS256 user JWTs against Bastion's JWKS and checks the
 * token's `appSlug` against `ADMIN_ACCEPTED_APP_SLUGS`.
 *
 * Extracted so both `AdminJwtGuard` (which additionally requires a local
 * `AdminUser` row) and `BastionUserJwtGuard` (which accepts any verified
 * Bastion user token — used by self-service endpoints like `/me/avatar`) share
 * the exact same signature/appSlug verification instead of drifting apart.
 */
@Injectable()
export class BastionTokenVerifier {
  private jwksCache: JwksCache | null = null;

  /**
   * App slugs whose Bastion-issued user tokens this service accepts.
   *
   * FileHarbor has no admin UI of its own — the console lives in Meridian, which
   * signs its users in against Bastion with its own `appSlug`. Accepting a list
   * lets one deployment serve several front-ends (Meridian plus any future one)
   * without each needing a separate FileHarbor app registration in Bastion.
   *
   * Defaults to `BASTION_APP_SLUG` alone, so an unset variable keeps the previous
   * single-slug behaviour rather than silently widening what is accepted.
   */
  private readonly acceptedAppSlugs: string[];

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    const configured = this.config.get<string>('adminAcceptedAppSlugs') ?? '';
    const parsed = configured
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);

    this.acceptedAppSlugs = parsed.length
      ? parsed
      : [this.config.get<string>('bastionAppSlug') ?? 'fileharbor'];
  }

  /**
   * Verifies an `Authorization: Bearer <token>` header against Bastion's JWKS
   * and checks the decoded `appSlug` against the accepted list.
   * Throws `UnauthorizedException` on any failure.
   */
  async verifyAuthHeader(
    authHeader: string | undefined,
  ): Promise<BastionJwtPayload> {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.substring(7);
    const payload = await this.verifyToken(token);

    if (!this.acceptedAppSlugs.includes(payload.appSlug)) {
      throw new UnauthorizedException('Invalid app context');
    }

    return payload;
  }

  private async verifyToken(token: string): Promise<BastionJwtPayload> {
    let lastAttemptWasRetry = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) this.jwksCache = null; // force re-fetch on retry (key rotation)
        const pem = await this.getPublicKeyPem();
        return this.jwtService.verify<BastionJwtPayload>(token, {
          secret: pem,
          algorithms: ['RS256'],
        });
      } catch (error) {
        lastAttemptWasRetry = attempt === 1;
        if ((error as any)?.name === 'TokenExpiredError') break;
      }
    }
    void lastAttemptWasRetry;
    throw new UnauthorizedException('Invalid or expired token');
  }

  private async getPublicKeyPem(): Promise<string> {
    const now = Date.now();
    if (this.jwksCache && this.jwksCache.expiresAt > now) {
      return this.keysToPem(this.jwksCache.keys);
    }

    const bastionUrl = this.config.get<string>('bastionUrl');
    let response: Response;
    try {
      response = await fetch(`${bastionUrl}/.well-known/jwks.json`);
    } catch {
      throw new ServiceUnavailableException(
        'Authentication service unreachable',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Authentication service unavailable',
      );
    }

    const { keys: rawKeys } = (await response.json()) as { keys: JsonWebKey[] };
    const keys = rawKeys
      .filter((k) => k.use === 'sig' && k.kty === 'RSA')
      .map((k) =>
        crypto.createPublicKey({
          key: k as crypto.JsonWebKeyInput['key'],
          format: 'jwk',
        }),
      );

    if (keys.length === 0) {
      throw new ServiceUnavailableException(
        'No valid signing keys found in JWKS',
      );
    }

    this.jwksCache = { keys, expiresAt: now + JWKS_TTL_MS };
    return this.keysToPem(keys);
  }

  private keysToPem(keys: crypto.KeyObject[]): string {
    return keys[0].export({ type: 'spki', format: 'pem' }) as string;
  }
}
