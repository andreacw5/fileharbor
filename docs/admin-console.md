# Admin console & self-service — auth, scope, audit

Dettaglio della superficie `/admin/*` e `/me/*`. Riassunto in [`CLAUDE.md`](../CLAUDE.md).

## Admin Module


Separate auth domain — does **not** use `ClientInterceptor` or `X-API-Key`. Admin identity lives
**entirely in Bastion**: FileHarbor issues no tokens, stores no admin passwords and, since the
`admin_users` removal, keeps no admin accounts at all.

Three parts:

- `src/modules/bastion/` — everything Bastion, built on `@heyatom/bastion-client` like Herald, Beacon,
  Gatherly and Articuno. `bastion.module.ts` imports the package's `BastionModule.forRootAsync(...)`
  (global) from the camelCase config keys. **From the package**: `BastionJwksService` (RS256 against
  the JWKS, `kid`-indexed cache), `BastionAuditService` (service-client token + `POST /events`),
  `AuditInterceptor`, `@Audit()`, `@Public()`, and `UserJwtPayload` (re-exported from
  `bastion.types.ts`). **Local**: `BastionTokenVerifier`
  (multi-app acceptance), the two guards, `console-permissions.ts`, `@RequirePermission`,
  `@CurrentAdminUser`, `@CurrentUser`, and `AdminJwtPayload`/`BastionUserPayload`. No controller —
  sign-in, refresh, password and profile all belong to Bastion, and the console (Meridian) talks to
  Bastion directly.
- `src/modules/admin/` — the admin API itself (`admin/clients`, `admin/images`, `admin/videos`,
  `admin/albums`, `admin/creators`, `admin/avatars`, `admin/bookmarks`, `admin/image-share-links`)
- **Duplicates** (plan 03): `Image.dHash` is a 256-bit dHash (17x16 grid) of `original.webp` as 64 hex chars
  (`StorageService.computeDHash`, set on upload, best-effort: a failure leaves it `null`). Text, not
  `BigInt`, because raw image rows are spread into responses. `GET /admin/images/duplicates` groups by
  `(clientId, dHash)` inside `allowedClientIds` (`crossClient=true` → `dHash` alone, `fullAccess` only),
  `GET /admin/images?dHash=` lists one group, the show carries `dHash` + `duplicates`. The all-zero
  hash (flat image) never counts as a duplicate. Never auto-delete: deleting is the bulk-delete.
- **Optimize status** (plan 07): `GET /admin/images` and `/admin/avatars` take `optimizeStatus=optimized|pending|failed`,
  mapped on `OPTIMIZE_RETRYABLE_WHERE` / `OPTIMIZE_GIVEN_UP_WHERE` (the metric's own predicates); both DTOs
  expose `optimizeAttempts`. Re-queue with `…/:id/reoptimize` / `…/reoptimize-failed` (see Scheduled Jobs).
- `src/modules/statistics/` — `GET admin/stats`, guarded the same way but living outside `admin/`:
  scoped totals, a 7-day trend and a per-day chart. `totalStorage` / `newStorage` sum image, video and avatar bytes.
  **Storage report** (plan 04): `StorageSnapshot` is the only storage history (live rows rewrite the past on
  delete/optimize), per client, never per creator. `storageByKind` + `dailyChart[].storage` (snapshot bytes,
  `null` on a day with none) on `GET admin/stats`; `GET admin/stats/storage?from&to&clientId` (bare object,
  ≤ 366 days, series `null` before `firstSnapshot`, `byClient` live); `GET admin/stats/storage/creators`
  (`{ data, meta }`, live, **`library.manage`**). Every byte figure is the originals' `size`: no thumbs, no
  cached variants. All live per-client sums go through `storageUsageByClient` (`statistics/storage-usage.ts`),
  shared with `ClientService` — never a second copy of the query.

### Guard

**`BastionUserGuard`** (`bastion/guards/bastion-user.guard.ts`) does three things with
`Authorization: Bearer <token>`:

1. **Verifies** RS256 against Bastion's JWKS (`BASTION_URL/.well-known/jwks.json`) via the package's
   `BastionJwksService`, rejects service-client tokens, and checks `payload.appSlug` against
   `ADMIN_ACCEPTED_APP_SLUGS` (`BastionTokenVerifier`, local). Not the package's `verifyUserToken`:
   that pins `aud` to FileHarbor's own slug, while the console signs in as `meridian`.
2. **Enforces the route's console permission**, fail-closed. A refusal writes one
   `admin.access_denied` audit event per (appSlug, reason) every 5 minutes — the cooldown keeps a
   retrying misconfigured caller from exhausting the `/events` budget.
3. **Resolves which clients the caller may see**, and attaches `request.adminUser`
   (`AdminJwtPayload`: Bastion claims plus `principalId`, `fullAccess`, `actorId`, `allowedClientIds`).

**`@CurrentAdminUser()`** (`bastion/decorators/current-admin-user.decorator.ts`) extracts the payload.

Steps 2 and 3 are FileHarbor's own, so this guard is local rather than a subclass of the package's
`BastionUserGuard` (as Gatherly and Articuno do): it checks permissions instead of a role allowlist,
and resolves a per-client scope. Only the audit writer (`BastionAuditService`) comes from the package.

**JWKS caching** (the package's) is per `kid`, not a single PEM: during a rotation Bastion publishes
more than one key, and pinning any one of them would reject tokens signed with the others. The TTL
is 5 minutes (`BASTION_JWKS_TTL_MS=300000`, Bastion's `Cache-Control`); an unknown `kid` triggers at
most one immediate re-fetch per 30s, so a rotation is transparent rather than a wait-out-the-TTL
outage; a failed re-fetch leaves the working cache intact.

### Permissions — checked here, not only in Meridian

Meridian's BFF maps routes to `fileharbor-*` permissions, but a BFF is not a security boundary:
anything that can reach this service with a valid Bastion user token would otherwise get the whole
admin surface. So the guard re-checks the `permissions` claim.

```typescript
@RequirePermission('fileharbor-library.manage')   // class-level, overridable per handler
```

- **Fail-closed**: a route behind `BastionUserGuard` with no `@RequirePermission` is refused (403) to
  everyone but `SUPER_ADMIN`. A missing decorator is a bug to fix, not a hole to leave open.
- `SUPER_ADMIN` bypasses the permission check (only the check — see scope below).
- The four keys live in `bastion/console-permissions.ts`. Keep them in step with Bastion's
  `prisma/seed.ts` and Meridian's `server/utils/permission-policy.ts`:
  `fileharbor-media.manage`, `fileharbor-media.moderate`, `fileharbor-library.manage`,
  `fileharbor-config.manage`.
- Permissions travel in the access token and are not resolved per request, so a role change in
  Bastion lands here only on the next refresh (max 15 min).

### Client scope — the tenant, plus exceptions

Scope is **never** granted by a role. `SUPER_ADMIN` included: a role says what you may do, not whose
data you may see. Otherwise personal clients would leak to whoever holds the highest role.

| Caller | Sees |
|---|---|
| anyone (default) | clients whose `bastionTenantSlug` matches the token's `tenantSlug` |
| principal with `fullAccess` | every client **except** other principals' personal ones |
| owner of a personal client | that client too, from any tenant they sign in through |

Having no principal row is not an error — it means "your tenant only", so nothing has to be
provisioned before a Meridian user works. A caller whose tenant maps to no client simply gets empty
lists.

Never filter by hand — use `admin/helpers/admin-access.helper.ts`:

```typescript
resolveAllowedClients(admin)            // string[] — always explicit, never "unrestricted"
assertClientAccess(admin, clientId)     // throws ForbiddenException
buildClientWhere(admin, extraClientId?) // Prisma where clause, validates extraClientId
```

### `AdminPrincipal` / `AdminIdentity` — the exceptions table

A Bastion `sub` is **per tenant**: the same person signing into two tenants is two Bastion users with
two different subs. `AdminIdentity` maps those subs onto one `AdminPrincipal`, which is what lets one
person carry the same reach — and the same personal clients — whichever tenant they enter through.

The table holds **only exceptions** (someone with `fullAccess`, or who owns a personal client). It is
not a mirror of Bastion's users, and it has **no API**: rows are written by hand, which keeps the
privilege surface off the network entirely.

```sql
-- one person, one row
INSERT INTO admin_principals (id, label, "fullAccess", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'andrea', true, NOW(), NOW());

-- one row per tenant they sign in through (sub = the JWT's `sub` claim in that tenant)
INSERT INTO admin_identities (id, "principalId", "bastionUserId", "tenantSlug", "createdAt")
VALUES (gen_random_uuid(), '<principal-id>', '<sub>', 'dbd', NOW());

-- a personal client: owned by a person, not mapped to a tenant
UPDATE clients SET "ownerPrincipalId" = '<principal-id>', "bastionTenantSlug" = NULL
WHERE id = '<client-id>';
```

⚠️ **Recovery is SQL-only.** Lose every identity of a `fullAccess` principal and the only way back in
is the database. There is no endpoint that grants access.

### Personal clients

`Client.ownerPrincipalId` and `Client.bastionTenantSlug` are mutually exclusive (CHECK constraint
`clients_owner_xor_tenant`): a client belongs to a tenant **or** to a person.

A personal client is invisible in the console to everyone but its owner — lists, stats, tags,
bookmarks and direct id lookups alike. This is the console only: the `X-API-Key` surface is
unaffected (whoever holds the key reads the data), public image delivery follows its own rules, and
anyone with database or disk access sees everything.

`POST /admin/clients` is `SUPER_ADMIN`-only and defaults `bastionTenantSlug` to the creator's tenant —
an unmapped client would be invisible to its own author. Creating one with no mapping at all is
allowed only for a `fullAccess` principal; anyone else gets `400`.

### Bookmarks and `actorId`

Admin bookmarks are keyed on `actorId`: the principal id when the caller is linked, otherwise
`sub:<sub>`. A linked person therefore keeps one set of bookmarks across tenants, and an unlinked one
keeps their own without needing a row anywhere.

Required env vars:
```
BASTION_URL=http://localhost:3001
BASTION_APP_SLUG=fileharbor
ADMIN_ACCEPTED_APP_SLUGS=fileharbor,meridian  # empty → BASTION_APP_SLUG only
BASTION_CLIENT_API_KEY=<key-from-bastion>     # outgoing only (audit); empty → audit disabled
BASTION_TENANT_SLUG=                          # only if the service client is tenant-bound
BASTION_JWKS_TTL_MS=300000                    # matches Bastion's JWKS Cache-Control
```

### Audit — `@Audit()` on console writes

Admin writes report to Bastion's audit log. Same mechanism as Herald and Beacon:

```typescript
@Audit('fh_image.deleted', {
  metadata: (_r: unknown, req: AuditRequest) => ({ imageId: req.params.id }),
})
```

- `AuditInterceptor` is registered globally (`APP_INTERCEPTOR` in `app.module.ts`) and is a no-op on a
  handler with no `@Audit()`, so a new admin route can't silently skip it by forgetting a decorator on
  the controller.
- Writes are **fire-and-forget**: `tap()`, no `await`, every failure swallowed and logged. An audit must
  never fail the operation it tracks.
- `AuditInterceptor`, `@Audit()` and `BastionAuditService` all come from `@heyatom/bastion-client/nest`.
- The actor is `request.adminUser` (typed by the package as `AuditActor`, which `AdminJwtPayload`
  satisfies). `BastionAuditService.writeAsAdmin()` sets Bastion's `userId` when the
  admin's tenant matches the service client's, and falls back to `actorId`/`actorRole`/`actorAppSlug` in
  the metadata when it doesn't — Bastion rejects the whole write for a cross-tenant `userId`.
- Event names use FileHarbor's `fh_` prefix (`fh_image.uploaded`, `fh_client.updated`, …): Bastion's regex
  allows exactly two segments and the nouns here (`image`, `client`, `creator`) would otherwise collide with
  other services'.
- Metadata carries ids and **field names**, never field values — a client update body can hold a Tinify
  API key.
- Without `BASTION_CLIENT_API_KEY` the service starts normally and skips every write, with a warning per
  skipped event.

Bookmarks are deliberately **not** audited: they are per-actor console UI state, not a change to anyone's
data, and one event per toggle would spend the `/events` budget on noise.

#### Client surface (`X-API-Key`)

Where the information is lost or visibility changes, client writes are audited too (plan 10), under the
console's event names: `DELETE /images/:imageId`, `/videos/:id`, `/avatars/:externalUserId`,
`/albums/:albumId` → `fh_{image,video,avatar,album}.deleted`; `PATCH /images/:imageId` and `/videos/:id`
**only when the body carries `isPrivate`** (images: or `blurPublic`) → `fh_{image,video}.updated`. Nothing else: no uploads, no
metadata or album edits, no share links (the row stays, or is temporary by design). There are no outgoing
webhooks: the per-client Discord ones were removed.

- `auditClientWrite()` (`common/client-audit.ts`) → `BastionAuditService.write()`, `void`, after the service
  succeeded: a 403/404 writes nothing. Not `@Audit()`: `AuditInterceptor` takes `request.adminUser` as the
  actor, and client routes have none.
- **In the client controllers, never the services**: `ImageService.deleteImage` & co. are shared with the
  admin routes, which `@Audit` already covers — writing in the service would double every console event.
- Metadata: `via: 'api_key'`, `clientId`, `externalUserId` (the `X-User-Id` actor, `null` without one), the
  resource id (`ownerExternalUserId` for the avatar's path). Never `userId`: an app's user id is not a
  Bastion user.
- The PATCH events add `fields` (`isPrivate` and/or `blurPublic`) **and those booleans**: the only values allowed in
  metadata, since they are the fact being tracked and not a secret.


## Self-Service Module (`/me`)

Separate from `admin/` — lets a Bastion-authenticated **end user** (not a console admin) manage their own
avatar. `src/modules/me/` (`me.module.ts`, `me.controller.ts`, `me.service.ts`, `dto/`).

### Guard: `BastionSelfServiceGuard`

`bastion/guards/bastion-self-service.guard.ts` verifies the Bastion user JWT the same way
`BastionUserGuard` does — signature against JWKS, no service-client tokens, `appSlug` in
`ADMIN_ACCEPTED_APP_SLUGS` — but requires **no console permission** and resolves no client scope. The
shared verification lives in `bastion/bastion-token-verifier.service.ts` (`BastionTokenVerifier`),
injected by both guards so they can't drift apart. `BastionSelfServiceGuard` attaches `request.bastionUser`
(`sub`, `tenantId`, `tenantSlug`, `appSlug`, `email`, `username`) — read it with the `@CurrentUser()`
decorator (`bastion/decorators/current-user.decorator.ts`). Never reuse it for admin/console routes —
it grants no permission check and no client scoping, only "this is *some* verified Bastion user of an
accepted app".

### `Client.bastionTenantSlug` — the tenant → client mapping

Self-service endpoints resolve which FileHarbor `Client` owns the caller's data by looking up
`Client.bastionTenantSlug` (nullable, `@unique`) against the token's `tenantSlug`. Bastion tenant slugs are
immutable, so this is a safe join key. A tenant with **no** mapped client (e.g. a "personal" tenant with no
dedicated FileHarbor client) never gets self-service avatars — there's no silent fallback to a default
client. Set the mapping via `PATCH /admin/clients/:id` (`bastionTenantSlug`, admin-only, lowercase slug,
`null`/`""` clears it), or at creation time via `POST /admin/clients` (`SUPER_ADMIN` only — every other
role gets `403`, and the creator's own tenant is the default); either way a slug already mapped to
another client responds `409 Conflict`. A client owned by a principal cannot carry a tenant slug at all. Creation
also enforces a unique `domain` the same way. `POST /admin/clients` is the only client response that
ever returns the plaintext `apiKey` — every other read/update masks or omits it.

### `GET/PUT/DELETE /me/avatar`

- `GET /me/avatar` → `{ enabled, avatar }`. `enabled` reflects only whether the tenant has a mapped
  **active** client — `avatar` is `null` (not a 404) when the mapping exists but the user hasn't uploaded
  one yet.
- `PUT /me/avatar` (multipart, field `file`, PNG/JPEG/WebP/GIF, 5 MB limit) and `DELETE /me/avatar` both
  resolve the client first and respond `422 UnprocessableEntityException` ("No FileHarbor client mapped to
  this tenant") when unmapped or inactive — **before** touching `AvatarService`.
- `externalUserId` passed to `AvatarService` is always the verified token `sub`. It is never read from the
  request body or a header — unlike the client-key `POST /avatars`, which trusts `externalUserId` from the
  form body because the caller there is a trusted service, not an end user.

