import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  BASTION_OPTIONS,
  BastionJwksService,
  BastionModuleOptions,
  isServiceClientToken,
} from '@heyatom/bastion-client/nest';
import { UserJwtPayload } from './bastion.types';

/**
 * Turns an `Authorization` header into a verified Bastion **user** payload:
 * signature (via the package's `BastionJwksService`), machine-token rejection,
 * and the `appSlug` allowlist.
 *
 * Not the package's `verifyUserToken`: that one pins `aud` to this service's own
 * slug, while FileHarbor accepts user tokens of several apps (Meridian plus any
 * future front-end) — `ADMIN_ACCEPTED_APP_SLUGS`, resolved in `bastion.module.ts`.
 *
 * Both guards share it so they cannot drift apart — `BastionUserGuard` adds the
 * permission check and the client scope on top, `BastionSelfServiceGuard` adds
 * nothing at all.
 */
@Injectable()
export class BastionTokenVerifier {
  private readonly acceptedAppSlugs: string[];

  constructor(
    private readonly jwks: BastionJwksService,
    @Inject(BASTION_OPTIONS) options: BastionModuleOptions,
  ) {
    this.acceptedAppSlugs = options.acceptedAppSlugs ?? [options.serviceSlug];
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
    if (isServiceClientToken(payload)) {
      throw new UnauthorizedException('Service client token not allowed');
    }

    if (!this.acceptedAppSlugs.includes(payload.appSlug)) {
      throw new UnauthorizedException('Invalid app context');
    }

    return payload;
  }
}
