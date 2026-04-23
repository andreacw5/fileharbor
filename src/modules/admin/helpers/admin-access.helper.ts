import { ForbiddenException } from '@nestjs/common';
import { AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';

/**
 * Returns the list of allowed clientIds for a given admin payload.
 * SUPER_ADMIN or allClientsAccess=true → null (no restriction).
 * Otherwise → array of allowed IDs (may be empty).
 */
export function resolveAllowedClients(admin: AdminJwtPayload): string[] | null {
  if (admin.role === 'SUPER_ADMIN' || admin.allClientsAccess) return null;
  return admin.allowedClientIds;
}

/**
 * Asserts that `clientId` is in the admin's allowed list (or unrestricted).
 * Throws ForbiddenException if access is denied.
 */
export function assertClientAccess(admin: AdminJwtPayload, clientId: string): void {
  const allowed = resolveAllowedClients(admin);
  if (allowed !== null && !allowed.includes(clientId)) {
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
): { clientId?: string | { in: string[] } } {
  if (extraClientId) {
    assertClientAccess(admin, extraClientId);
    return { clientId: extraClientId };
  }
  const allowed = resolveAllowedClients(admin);
  if (allowed === null) return {};
  return { clientId: { in: allowed } };
}

