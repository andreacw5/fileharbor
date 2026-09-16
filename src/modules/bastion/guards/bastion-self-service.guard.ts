import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';
import { BastionUserPayload } from '../bastion.types';

/**
 * Verifies the Bastion user JWT (signature + appSlug, via `BastionTokenVerifier`)
 * and attaches the decoded identity to `request.bastionUser`.
 *
 * Unlike `BastionUserGuard` it enforces **no console permission** and resolves
 * **no client scope** — it only establishes "this is *some* verified Bastion user
 * of an accepted app". That is what `/me/*` needs, where the caller acts on their
 * own behalf; it is never enough for a console route, so do not reuse it there.
 */
@Injectable()
export class BastionSelfServiceGuard implements CanActivate {
  constructor(private readonly tokenVerifier: BastionTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.tokenVerifier.verifyAuthHeader(
      request.headers['authorization'],
    );

    (request as any).bastionUser = {
      sub: payload.sub,
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      appSlug: payload.appSlug,
      email: payload.email,
      username: payload.username,
    } satisfies BastionUserPayload;

    return true;
  }
}
