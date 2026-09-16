import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BastionJwksService } from './bastion-jwks.service';
import { UserJwtPayload } from './bastion.types';

/**
 * Turns an `Authorization` header into a verified Bastion **user** payload:
 * signature (via `BastionJwksService`), machine-token rejection, and the
 * `appSlug` allowlist.
 *
 * Both guards share it so they cannot drift apart — `BastionUserGuard` adds the
 * permission check and the client scope on top, `BastionSelfServiceGuard` adds
 * nothing at all.
 */
@Injectable()
export class BastionTokenVerifier {
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
    private readonly jwks: BastionJwksService,
    private readonly config: ConfigService,
  ) {
    const parsed = (this.config.get<string>('adminAcceptedAppSlugs') ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean);

    this.acceptedAppSlugs = parsed.length
      ? parsed
      : [this.config.get<string>('bastionAppSlug') ?? 'fileharbor'];
  }

  /**
   * Verifies an `Authorization: Bearer <token>` header and checks the decoded
   * `appSlug` against the accepted list. Throws `UnauthorizedException` on any
   * failure.
   */
  async verifyAuthHeader(
    authHeader: string | undefined,
  ): Promise<UserJwtPayload> {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const payload = await this.jwks.verify(authHeader.substring(7));

    // A machine token is not a person. FileHarbor's machine surface is the
    // `X-API-Key` one; the Bastion-authenticated surface is for users only.
    if (payload.type === 'service_client') {
      throw new UnauthorizedException('Service client token not allowed');
    }
    // `type` is deliberately not narrowed on UserJwtPayload — see bastion.types.ts.
    const user = payload as UserJwtPayload;

    if (!this.acceptedAppSlugs.includes(user.appSlug)) {
      throw new UnauthorizedException('Invalid app context');
    }

    return user;
  }
}
