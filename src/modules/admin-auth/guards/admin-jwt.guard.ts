import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '@/modules/prisma/prisma.service';

export interface BastionJwtPayload {
  sub: string;
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

export interface AdminJwtPayload {
  // From Bastion JWT
  sub: string;
  email: string;
  username?: string;
  image?: string;
  role: string;
  appSlug: string;
  permissions: string[];
  // Enriched from local AdminUser
  adminUserId: string;
  allClientsAccess: boolean;
  allowedClientIds: string[];
}

interface JwksCache {
  keys: crypto.KeyObject[];
  expiresAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AdminJwtGuard implements CanActivate {
  private jwksCache: JwksCache | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.substring(7);
    const bastionPayload = await this.verifyToken(token);

    const expectedSlug = this.config.get<string>('bastionAppSlug');
    if (bastionPayload.appSlug !== expectedSlug) {
      throw new UnauthorizedException('Invalid app context');
    }

    const adminUser = await this.prisma.adminUser.findUnique({
      where: { bastionUserId: bastionPayload.sub },
      include: { clientAccess: { select: { clientId: true } } },
    });

    if (!adminUser || !adminUser.active) {
      throw new UnauthorizedException('Admin access not granted');
    }

    (request as any).adminUser = {
      sub: bastionPayload.sub,
      email: bastionPayload.email,
      username: bastionPayload.username,
      image: bastionPayload.image,
      role: bastionPayload.role,
      appSlug: bastionPayload.appSlug,
      permissions: bastionPayload.permissions ?? [],
      adminUserId: adminUser.id,
      allClientsAccess: adminUser.allClientsAccess,
      allowedClientIds: adminUser.clientAccess.map((a) => a.clientId),
    } satisfies AdminJwtPayload;

    // 5.6: fire-and-forget UserCache upsert — keeps Bastion profile data fresh
    this.upsertUserCache(bastionPayload).catch(() => undefined);

    return true;
  }

  private async upsertUserCache(payload: BastionJwtPayload): Promise<void> {
    await this.prisma.userCache.upsert({
      where: { id: payload.sub },
      create: {
        id: payload.sub,
        username: payload.username ?? null,
        email: payload.email,
        image: payload.image ?? null,
      },
      update: {
        username: payload.username ?? null,
        email: payload.email,
        image: payload.image ?? null,
      },
    });
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
      throw new ServiceUnavailableException('Authentication service unreachable');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Authentication service unavailable');
    }

    const { keys: rawKeys } = (await response.json()) as { keys: JsonWebKey[] };
    const keys = rawKeys
      .filter((k) => k.use === 'sig' && k.kty === 'RSA')
      .map((k) => crypto.createPublicKey({ key: k as crypto.JsonWebKeyInput['key'], format: 'jwk' }));

    if (keys.length === 0) {
      throw new ServiceUnavailableException('No valid signing keys found in JWKS');
    }

    this.jwksCache = { keys, expiresAt: now + JWKS_TTL_MS };
    return this.keysToPem(keys);
  }

  private keysToPem(keys: crypto.KeyObject[]): string {
    return keys[0].export({ type: 'spki', format: 'pem' }) as string;
  }
}
