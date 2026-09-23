/**
 * Bastion JWT payloads. The Bastion claims come from `@heyatom/bastion-client`;
 * what stays here is what FileHarbor puts on the request after verifying one.
 *
 * FileHarbor accepts no service-client token (its machine surface is the
 * `X-API-Key` one) and only *issues* requests with one, for audit writes.
 */
export type {
  BastionJwtPayload,
  ServiceClientJwtPayload,
  TokenResponse,
  UserJwtPayload,
} from '@heyatom/bastion-client';

/**
 * What `BastionUserGuard` attaches to `request.adminUser`: the Bastion claims
 * plus the bits FileHarbor resolves locally (principal link and client scope).
 *
 * Unlike the other services, the console surface here is scoped per client, so
 * the guard cannot stop at "is this a valid admin" — see `bastion-user.guard.ts`.
 */
export interface AdminJwtPayload {
  // From the Bastion JWT
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email: string | null;
  username?: string | null;
  image?: string | null;
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
 * What `BastionSelfServiceGuard` attaches to `request.bastionUser`: a verified Bastion
 * user and nothing else. No principal, no client scope, no permission check —
 * used by `/me/*`, where the caller acts on their own behalf rather than as a
 * console admin.
 */
export interface BastionUserPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  appSlug: string;
  email: string | null;
  username?: string | null;
}
