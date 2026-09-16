/**
 * Bastion JWT payloads.
 *
 * Bastion signs two families of token with the same key:
 *
 * - **service client** — machine-to-machine, `type: 'service_client'`. FileHarbor
 *   only ever *issues* requests with one (audit writes); it accepts none, because
 *   its machine surface is the `X-API-Key` one.
 * - **user** — a real person signed into an app (the console lives in Meridian).
 *   No `type: 'service_client'`, carries `appSlug`, `role` and `permissions`.
 */

export interface ServiceClientJwtPayload {
  sub: string;
  type: 'service_client';
  tenantId: string;
  tenantSlug: string;
  serviceSlug: string;
  scopes: string[];
  iat: number;
  exp: number;
}

/**
 * User JWT issued by Bastion. `type` is deliberately `string` and not narrowed:
 * Bastion emits more than one kind of user token and enumerating them here would
 * mean editing this file every time a new one appears. What matters is that it is
 * *not* `service_client` — the guards check exactly that.
 */
export interface UserJwtPayload {
  sub: string;
  type?: string;
  appSlug: string;
  role: string;
  permissions?: string[];
  tenantId: string;
  tenantSlug: string;
  email: string;
  username?: string;
  image?: string;
  preferredLocale?: string;
  iat: number;
  exp: number;
}

export type BastionJwtPayload = ServiceClientJwtPayload | UserJwtPayload;

export interface TokenResponse {
  accessToken: string;
}

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
  email: string;
  username?: string;
}
