import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';

/**
 * Bastion user identity attached to `request.bastionUser` by `BastionUserJwtGuard`.
 * Unlike `AdminJwtPayload`, this carries no local enrichment (no AdminUser row,
 * no role/permissions gate) — any signed-in Bastion user of an accepted app
 * passes. Used by self-service endpoints (e.g. `/me/avatar`) where the caller
 * is acting on their own behalf, not as a console admin.
 */
export interface BastionUserPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  appSlug: string;
  email: string;
  username?: string;
}

/**
 * Verifies the Bastion user JWT (signature + appSlug, via `BastionTokenVerifier`)
 * and attaches the decoded identity to `request.bastionUser`. Unlike
 * `AdminJwtGuard`, it does NOT require a local `AdminUser` row — it accepts
 * any signed-in user of an accepted app. Do not reuse for admin/console
 * endpoints; use `AdminJwtGuard` there.
 */
@Injectable()
export class BastionUserJwtGuard implements CanActivate {
  constructor(private readonly tokenVerifier: BastionTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.tokenVerifier.verifyAuthHeader(request.headers['authorization']);

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
