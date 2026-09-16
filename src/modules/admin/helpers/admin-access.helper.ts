import { ForbiddenException } from '@nestjs/common';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';

/**
 * The clients this admin may see, resolved by `AdminJwtGuard` from the token's
 * tenant plus any personal clients they own.
 *
 * There is deliberately no "unrestricted" answer any more: a role — SUPER_ADMIN
 * included — never widens client scope by itself, otherwise personal clients
 * would leak to whoever holds the highest role. Reach across tenants comes from
 * an `AdminPrincipal` with `fullAccess`, and even that excludes other people's
 * personal clients. The list is always explicit.
 */
export function resolveAllowedClients(admin: AdminJwtPayload): string[] {
  return admin.allowedClientIds;
}

/**
 * Asserts that `clientId` is one the admin may see.
 * Throws ForbiddenException if access is denied.
 */
export function assertClientAccess(admin: AdminJwtPayload, clientId: string): void {
  if (!admin.allowedClientIds.includes(clientId)) {
    throw new ForbiddenException('You do not have access to this client');
  }
}

/**
 * Builds a Prisma WHERE clause that scopes queries by allowed clients.
 * If extraClientId is provided it is validated first.
 */
export function buildClientWhere(
  admin: AdminJwtPayload,
  extraClientId?: string,
): { clientId: string | { in: string[] } } {
  if (extraClientId) {
    assertClientAccess(admin, extraClientId);
    return { clientId: extraClientId };
  }
  return { clientId: { in: admin.allowedClientIds } };
}
