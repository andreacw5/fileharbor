/**
 * Console permissions carried by Bastion's `permissions` claim.
 *
 * These are the same keys Meridian's BFF enforces on its own routes. FileHarbor
 * checks them again because the BFF is not a security boundary: anything able to
 * reach this service with a valid Bastion user token would otherwise get the
 * whole admin surface.
 *
 * Keep in sync with Bastion's `prisma/seed.ts` (`MERIDIAN_PERMISSIONS`) and
 * Meridian's `server/utils/permission-policy.ts`.
 */
export const CONSOLE_PERMISSIONS = [
  'fileharbor-media.manage',
  'fileharbor-media.moderate',
  'fileharbor-library.manage',
  'fileharbor-config.manage',
] as const;

export type ConsolePermission = (typeof CONSOLE_PERMISSIONS)[number];

/** Bastion role that bypasses the permission check entirely. */
export const CONSOLE_SUPER_ROLE = 'SUPER_ADMIN';
