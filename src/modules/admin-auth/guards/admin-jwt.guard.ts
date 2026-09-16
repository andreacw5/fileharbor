import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';
import { CONSOLE_SUPER_ROLE, ConsolePermission } from '../console-permissions';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

export interface AdminJwtPayload {
  // From Bastion JWT
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  username?: string;
  image?: string;
  role: string;
  appSlug: string;
  permissions: string[];
  // Resolved locally
  /** AdminPrincipal id when this Bastion user is linked to one, else null. */
  principalId: string | null;
  /** Principal with fullAccess: sees every client bar other principals' personal ones. */
  fullAccess: boolean;
  /** Owner key for personal data (bookmarks): principal id, or `sub:<sub>`. */
  actorId: string;
  /** Clients this caller may see, resolved per request. */
  allowedClientIds: string[];
}

/**
 * Admin guard for the console surface.
 *
 * Identity, roles and credentials live entirely in Bastion — this service keeps
 * no admin accounts. The guard:
 *
 * 1. verifies the RS256 token against Bastion's JWKS and the accepted app slugs
 *    (`BastionTokenVerifier`);
 * 2. enforces the route's console permission, fail-closed (SUPER_ADMIN bypasses);
 * 3. resolves which clients the caller may see.
 *
 * Client scope comes from the token's tenant, not from a role: a plain admin
 * sees the clients mapped to their tenant. The exceptions live in
 * `admin_principals` — a person granted `fullAccess`, and the owner of a personal
 * client. A personal client is visible only to its owner, fullAccess included.
 *
 * Having no principal row is not an error: it just means "your tenant only".
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly tokenVerifier: BastionTokenVerifier,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.tokenVerifier.verifyAuthHeader(
      request.headers['authorization'],
    );

    const isSuperAdmin = payload.role === CONSOLE_SUPER_ROLE;
    this.assertPermission(context, payload.permissions ?? [], isSuperAdmin);

    const identity = await this.prisma.adminIdentity.findUnique({
      where: { bastionUserId: payload.sub },
      select: { principal: { select: { id: true, fullAccess: true } } },
    });
    const principal = identity?.principal ?? null;

    (request as any).adminUser = {
      sub: payload.sub,
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      email: payload.email,
      username: payload.username,
      image: payload.image,
      role: payload.role,
      appSlug: payload.appSlug,
      permissions: payload.permissions ?? [],
      principalId: principal?.id ?? null,
      fullAccess: principal?.fullAccess ?? false,
      actorId: principal?.id ?? `sub:${payload.sub}`,
      allowedClientIds: await this.resolveVisibleClients(
        payload.tenantSlug,
        principal,
      ),
    } satisfies AdminJwtPayload;

    return true;
  }

  /**
   * Fail-closed permission check: a route with no `@RequirePermission` is refused
   * to everyone but SUPER_ADMIN, so forgetting the decorator cannot open an
   * endpoint by accident.
   */
  private assertPermission(
    context: ExecutionContext,
    granted: string[],
    isSuperAdmin: boolean,
  ): void {
    if (isSuperAdmin) return;

    const required = this.reflector.getAllAndOverride<
      ConsolePermission | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!required || !granted.includes(required)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * A personal client (`ownerPrincipalId`) is never visible to anyone but its
   * owner — `fullAccess` widens reach across tenants, not into someone else's
   * private data.
   */
  private async resolveVisibleClients(
    tenantSlug: string | undefined,
    principal: { id: string; fullAccess: boolean } | null,
  ): Promise<string[]> {
    const where = principal?.fullAccess
      ? { OR: [{ ownerPrincipalId: null }, { ownerPrincipalId: principal.id }] }
      : {
          OR: [
            ...(tenantSlug ? [{ bastionTenantSlug: tenantSlug }] : []),
            ...(principal ? [{ ownerPrincipalId: principal.id }] : []),
          ],
        };

    // No tenant match and no principal: nothing to look at, and no query to run.
    if (!where.OR.length) return [];

    const clients = await this.prisma.client.findMany({
      where,
      select: { id: true },
    });
    return clients.map((client) => client.id);
  }
}
