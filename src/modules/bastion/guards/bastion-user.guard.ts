import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { BastionTokenVerifier } from '../bastion-token-verifier.service';
import { AdminJwtPayload } from '../bastion.types';
import { CONSOLE_SUPER_ROLE, ConsolePermission } from '../console-permissions';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/** One `admin.access_denied` per (appSlug, reason) pair every 5 minutes. */
const ACCESS_DENIED_COOLDOWN_MS = 5 * 60 * 1000;
/** Keys come from a signed JWT, so they are bounded by the tenant's real apps;
 *  the cap is only a safety net against growth. */
const ACCESS_DENIED_MAX_KEYS = 50;

/**
 * Guard for the console surface (`/admin/*`, `/admin/stats`, `/admin/tags`).
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
 *
 * This is FileHarbor's equivalent of the `BastionUserGuard` in Herald, Beacon and
 * Gatherly. It checks permissions rather than a role allowlist, and it resolves a
 * per-client scope those services have no equivalent of.
 */
@Injectable()
export class BastionUserGuard implements CanActivate {
  private readonly accessDeniedReportedAt = new Map<string, number>();

  constructor(
    private readonly tokenVerifier: BastionTokenVerifier,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly audit: BastionAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.tokenVerifier.verifyAuthHeader(
      request.headers['authorization'],
    );

    const isSuperAdmin = payload.role === CONSOLE_SUPER_ROLE;
    this.assertPermission(
      context,
      payload.permissions ?? [],
      isSuperAdmin,
      payload,
      request,
    );

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
    actor: { sub: string; appSlug: string; role: string },
    request: Request,
  ): void {
    if (isSuperAdmin) return;

    const required = this.reflector.getAllAndOverride<
      ConsolePermission | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!required || !granted.includes(required)) {
      this.reportAccessDenied(
        required ? 'permission_missing' : 'route_undeclared',
        actor,
        request,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Writes `admin.access_denied` with a cooldown per (appSlug, reason) pair.
   *
   * Without the cooldown every rejected request produces a write to Bastion: one
   * misconfigured caller in retry (a bad Meridian deploy, or anyone holding a
   * valid JWT of another app) would saturate FileHarbor's budget on Bastion's
   * `/events` endpoint on its own, and from then on legitimate events get
   * dropped silently. The attempt is worth tracking, but once per episode — the
   * repetition stays visible in the application logs.
   */
  private reportAccessDenied(
    reason: 'permission_missing' | 'route_undeclared',
    actor: { sub: string; appSlug: string; role: string },
    request: Request,
  ): void {
    const key = `${actor.appSlug}:${reason}`;
    const now = Date.now();
    const last = this.accessDeniedReportedAt.get(key);
    if (last !== undefined && now - last < ACCESS_DENIED_COOLDOWN_MS) return;

    if (this.accessDeniedReportedAt.size >= ACCESS_DENIED_MAX_KEYS) {
      this.accessDeniedReportedAt.clear();
    }
    this.accessDeniedReportedAt.set(key, now);

    void this.audit.write('admin.access_denied', {
      metadata: {
        reason,
        appSlug: actor.appSlug,
        role: actor.role ?? 'none',
        path: request.originalUrl ?? request.url ?? 'unknown',
      },
    });
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
