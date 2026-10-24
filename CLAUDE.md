# FileHarbor – Claude Code Guide

## Tech Stack

- **Framework:** NestJS 11 (TypeScript, ES2021, CommonJS)
- **Database:** PostgreSQL + Prisma ORM (client generated into `node_modules/.prisma/client`)
- **Image Processing:** Sharp
- **Auth:** Bastion IdP RS256 JWT via JWKS (admin), API Keys (client)
- **Package Manager:** pnpm (enforced — never use npm or yarn)
- **Testing:** Jest
- **API Docs:** Swagger/OpenAPI at `/docs`, gated by `ENABLE_SWAGGER`
- **Shared runtime:** `@heyatom/nest-common` (exception filter, logging, metrics, Swagger, bootstrap, tag pagination)
- **Path alias:** `@/*` → `src/*`

## Architecture

Multi-tenant NestJS 11 image management API. All data scoped by `clientId`. Auth via `X-API-Key` header validated by `ClientInterceptor`. Creators referenced by external ID (`X-User-Id`) — FileHarbor auto-creates internal `Creator` records on first use.

**Modules** (`src/modules/`):
| Module | Role |
|--------|------|
| `client` | Auth, tenant resolution, creator identity |
| `image` | Upload, retrieval, transformations, share links |
| `avatar` | Single-avatar-per-creator lifecycle |
| `album` | Collections, token-based private access |
| `storage` | All disk I/O and Sharp image processing |
| `webhook` | Fire-and-forget Discord webhook notifications |
| `admin` | Admin console API: cross-client ops, scoped by tenant |
| `bastion` | Everything Bastion, on `@heyatom/bastion-client`: the package verifies tokens and writes audit events; guards, console permissions and multi-app acceptance stay local (no controller) |
| `prisma` | Database service wrapper |

## Auth & Request Context

**Security Note:** `X-Client-Id` header no longer accepted. Only `X-API-Key` auth supported.

Every non-`@Public()` controller goes through `ClientInterceptor` (`src/modules/client/interceptors/client.interceptor.ts`):
1. Reads `X-API-Key` → resolves `client` → attaches `request.clientId` and `request.client`
2. Reads `X-User-Id` (or falls back to `request.query.externalUserId` / `request.body.externalUserId`) → attaches `request.externalCreatorId`

```typescript
import { ClientId, CreatorExternalId } from '@/modules/client/decorators/client.decorator';
// CreatorExternalId reads request.externalCreatorId (the X-User-Id header, or its query/body fallback)
```

Mark public endpoints with `@Public()` from `@heyatom/bastion-client/nest`. On public endpoints the interceptor still populates `clientId` if a valid key is supplied.

## Creator Identity Pattern

FileHarbor never receives real user accounts. Services call:
```typescript
prisma.creator.findUnique({ where: { clientId_externalId: { clientId, externalId } } })
```
Create on first use. When no `X-User-Id` is provided, images are attributed to `externalId: 'system'` (auto-created alongside every new client in `createClient()` in `client.service.ts`).

## Storage Paths

Never construct paths manually — use `StorageService` helpers:
```
storage/{client.domain || clientId}/images/{imageId}/original.webp
storage/{client.domain || clientId}/images/{imageId}/thumb.webp
storage/{client.domain || clientId}/avatars/{creatorId}/original.webp
```
`StorageService.validatePath()` blocks directory traversal. `sanitizePathComponent()` strips `..`, `/`, `\`, and null bytes.

Default fallback images live at `storage/defaults.fileharbor/`. `GET /images/:id` returns `fileharbor_not_found.webp` or `fileharbor_permission_denided.webp` (note: typo in filename is intentional/existing) instead of 4xx for non-`info` requests.

## DTO / Response Pattern

All service responses shaped with `plainToInstance(..., { excludeExtraneousValues: true })`. Only `@Expose()` decorated properties are returned. Follow this for every new response DTO.

## Webhook System

Always call non-blocking:
```typescript
this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_UPLOADED, payload)
  .catch(error => this.logger.warn(...));
```
Webhooks are opt-in per client (`client.webhookEnabled` + `client.webhookUrl`). Failures must be swallowed — never let them propagate.

## Scheduled Jobs

No `job` module: each cron lives next to the module it serves (`ScheduleModule.forRoot()` in `app.module.ts`). Live:

| Job | Schedule | Does |
|-----|----------|------|
| `ImageCleanupJob.optimizeImages` | hourly | re-optimizes 50 unoptimized images, oldest first |
| `AvatarCleanupJob.optimizeAvatars` | hourly | same for avatars |
| `ImageCleanupJob.cleanExpiredShareLinks` | 04:00 | deletes expired image share links |
| `AlbumCleanupJob.cleanExpiredAlbumTokens` | 04:00 | deletes expired album tokens |
| `StorageCleanupJob.cleanOrphanedFiles` | 02:00 | **deletes** image/avatar/video dirs with no DB row (older than 1h) |
| `TinifyResetJob.resetTinifyUsageCounters` | 1st of month | resets Tinify usage counters |
| `TinifyAutoJob.compressLargeImages` | hourly at :30 | Tinify-compresses optimized images above the client's `tinifyAutoMinBytes`, largest first |
| `StorageSnapshotJob.snapshotStorage` | 00:30 UTC (+ at boot if today has none) | upserts `storage_snapshots`: one row per client × kind (IMAGE/VIDEO/AVATAR), zeros included |

Deletes remove the DB row first, then the files; a failed file delete only logs a `warn` and
leaves the dir to this sweep (a row pointing at missing files would be worse than a stray dir).

Optimize jobs: a failed row increments `optimizeAttempts` and is skipped once it reaches
`MAX_OPTIMIZE_ATTEMPTS` (3, `storage.service.ts`), so broken files can't fill every batch.
`POST admin/images/:id/reoptimize` (or `admin/avatars/…`, or `…/reoptimize-failed` for every given-up row in
scope) resets `optimizeAttempts` on unoptimized rows only (`409 ALREADY_OPTIMIZED` otherwise) and the next
hourly run picks them up; SQL (`optimizeAttempts = 0`) still works. Storage dirs map back to clients by `domain` **or** `id`
(`client.domain || clientId`); a dir matching neither is left alone.

Optimize jobs re-encode the original at `OPTIMIZE_QUALITY` (default 85, webp effort 4), not
`ORIGINAL_QUALITY` (default 100, uploads only), and write the new byte count to `size`
(`markAsOptimized(id, size)`). Rows optimized before that fix are realigned by the one-off
`src/scripts/backfill-media-size.ts` (in `src/` so it ships in `dist/`: in the container
`node dist/scripts/backfill-media-size.js [--apply]`, dry run by default). `src/scripts/backfill-image-dhash.ts`
(same shape, resumable on `dHash IS NULL`) fills `dHash` for images uploaded before plan 03. `src/scripts/regenerate-thumbnails.ts`
(same shape, `[--apply] [--client <id>]`) rebuilds every image thumb after a `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` change,
which otherwise applies to new uploads only. Every `@Cron` job runs inside
`PrismaService.runExclusive()` (a `pg_try_advisory_lock` on its own connection), so with several
replicas a job runs on one of them; the others log a skip.

Tinify auto-compress is opt-in per client: `Client.tinifyAutoMinBytes` (`null` = off, set via
`PATCH /admin/clients/:id`; 1048576 is the suggested start) is both flag and threshold, and still needs
`tinifyActive` + a key. The job calls `ImageService.compressImageWithTinify`, so it shares the manual
endpoint's quota (`currentTinifyUsage`/`currentTinifyLimit`, reserved atomically before the call, raised to
Tinify's `Compression-Count`, set to the limit on a Tinify 429), checks and webhook. At most
`TINIFY_AUTO_BATCH` (default 20) images per client per run, so the month's quota is spread. A failure bumps
`Image.tinifyAttempts` (skipped at `MAX_OPTIMIZE_ATTEMPTS`, reset by SQL); a 401, a 429 or our own limit
(`code: TINIFY_LIMIT_REACHED`) stops that client for the run instead. A compression that saves nothing keeps
our file but still counts. Only `isOptimized` rows: the optimize job would re-encode a Tinify output.

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
- **Duplicates** (plan 03): `Image.dHash` is a 64-bit dHash of `original.webp` as 16 hex chars
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
  API key and a webhook URL.
- Without `BASTION_CLIENT_API_KEY` the service starts normally and skips every write, with a warning per
  skipped event.

Bookmarks are deliberately **not** audited: they are per-actor console UI state, not a change to anyone's
data, and one event per toggle would spend the `/events` budget on noise.


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

## Naming Conventions

- Files: `kebab-case` (e.g., `album.service.ts`)
- Classes: `PascalCase` (e.g., `AlbumService`)
- Methods/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- DTOs in `dto/`, decorators in `decorators/`, interceptors in `interceptors/`

## Security & Rate Limiting

- Validate file types (JPEG, PNG, WebP, GIF accepted)
- Enforce `MAX_FILE_SIZE` from env
- EXIF metadata removed during optimization
- Sanitize file paths (handled by `StorageService`)
- Rate limiting via `@nestjs/throttler` — configured by `THROTTLE_TTL` and `THROTTLE_LIMIT` env vars
- The console surface (`admin/*`, every `BastionUserGuard` controller) is `@SkipThrottle()` at class level:
  Meridian's BFF calls from one IP for every admin, so an IP-keyed bucket (10/min by default) 429'd bulk
  actions. A new admin controller needs the decorator too.

## API Versioning

`API_PREFIX` (default empty → `POST /images`) is the single source of truth: `config.schema.ts` `apiPrefix` drives
`setGlobalPrefix` in `main.ts` (`/health/*` excluded) **and** every returned `url`/`fullPath` via `RouteHelperService`
(`src/utils/route.utils.ts`). Never concatenate a prefix by hand.

`path()` gives the relative `url`/`thumbnailUrl`/`shareUrl`/album token `url` (`/{prefix}/...`);
`fullUrl()` = `BASE_URL + path()` gives `fullPath`. Webhook links use `BASE_URL` directly.

**Prod (behind nginx)**: nginx serves `https://fileharbor.heyatom.dev/v2/...` and strips `/v2` before
proxying, so `API_PREFIX` stays **empty** and the public prefix lives in `BASE_URL=https://fileharbor.heyatom.dev/v2`.
Result: routes unprefixed, `fullPath` public (`.../v2/images/<id>`), relative fields bare (`/images/<id>`, no `/v2`).
Setting `API_PREFIX=v2` there would make the app serve `/v2/...` while nginx forwards `/images/...` → 404.

## Image Processing

Sharp handles all transformations. Inputs: JPEG, PNG, WebP, GIF. Storage always WebP. Operations:
- Auto WebP conversion + thumbnail generation on upload
- On-demand resize via query params
- EXIF removal
- Quality set from env vars
- Animated GIF/WebP stay animated (animated WebP original, thumb, variants, optimize). JPEG/PNG renders
  take the first frame. `MAX_INPUT_PIXELS` counts all frames. Tinify refuses animated originals (`400`):
  it would overwrite them with a single frame.

### On-demand variants — bounded by design

`GET /images/:id` is public and `@SkipThrottle()`, so its transforms are bounded instead of rate-limited:

- **Snapped, never rejected** (`image/image-variants.ts`): width/height round **up** to the next of
  `VARIANT_SIZES` (16 … 4096), quality to the nearest of `VARIANT_QUALITIES` (40/60/75/85/100). Old URLs
  keep working; close values share one cached file and one ETag (the controller snaps too).
- **Cache**: at most `MAX_CACHED_VARIANTS` (20) files under `{imageDir}/variants/`; past that a variant is
  rendered but not stored.
- **Render cap**: every `StorageService.resizeImage` call (image variants and avatar jpeg/png conversion,
  which is never cached) goes through a `Semaphore` (`utils/semaphore.ts`): `RENDER_CONCURRENCY` (default 2)
  at once, `RENDER_QUEUE_LIMIT` (default 20) waiting, the rest get `503` with `Retry-After: 1`
  (`RenderBusyException`: its `retryAfterSeconds: 1` becomes the header only, never the body). A view is counted only after the file is served. Uploads and the optimize jobs
  don't use it.
- **Regenerate** (plan 06): `POST admin/images/:id/regenerate` rebuilds `thumb.webp` from the stored original and
  empties `variants/`; id, original, `size` and optimize state are untouched, `updatedAt` moves last (ETag). `404`
  without an original, `422` when it is unreadable. Public GETs are `immutable`: a cache holding the old thumb keeps
  it, so the console reloads with `?t=<updatedAt>`. Images only (avatars re-upload on the same URL).

## DB Entities

`Client` → `Creator` (by `externalId`) → `Image`, `Avatar`
`Album` → `AlbumImage` (many-to-many with `Image`) → `AlbumToken` (temp access for private albums)
`AdminPrincipal` → `AdminIdentity` (Bastion subs) and → `Client` (personal clients)

A `Creator` owns content — images, videos, avatars and albums — referenced by `externalId`, and
authenticates nowhere. Real logins are Bastion users.

Always add indexes on frequently queried fields.

## Error Handling

```typescript
throw new NotFoundException('Image not found');
throw new ForbiddenException('Access denied');
throw new BadRequestException('Invalid file format');
throw new ConflictException({ code: 'SLUG_TAKEN', message: '…' }); // domain code
```

One global filter, nest-common's `AllExceptionsFilter` (`APP_FILTER`); it logs the route pattern, so
`/albums/shared/:token` never reaches the logs. Every exception gets a response (api.md §3):

```json
{ "statusCode": 404, "code": "NOT_FOUND", "message": "Image not found", "requestId": "…" }
```

- `errors: string[]` only on validation failures (`code: VALIDATION_FAILED`, `message: "Validation failed"`).
- Prisma `P2002`/`P2003` → 409, `P2025` → 404; anything else non-HTTP → 500 `INTERNAL_ERROR`, details in the log only.
- A number in `retryAfterSeconds` on the exception body becomes the `Retry-After` header.
- Logs only 5xx (`error`) and 401/403/429 (`warn`): scanner 404s (`/wp-admin`, `.env`, …) stay quiet but are answered.
- `GET /images/:id` 404/403 on a file request never reaches the filter: the controller serves the placeholder
  (`X-FileHarbor-Fallback`). No `TransformInterceptor` (no `{ data }` envelope) until phase 3.

## Config Access

`ConfigModule` is global with Joi validation (`src/configs/config.validation.ts`):
```typescript
this.config.get('THUMBNAIL_SIZE')    // raw env key
this.config.get('throttle.ttl')      // nested key from config.schema.ts
```

## Adding a New Feature Module

1. Follow existing structure: `controller` → `service` → `dto/` subdir
2. Apply `@UseInterceptors(ClientInterceptor)` at controller class level
3. Use `@ClientId()` / `@CreatorExternalId()` for tenant/creator context
4. Scope all Prisma queries with `where: { clientId }`
5. Return responses via `plainToInstance(ResponseDto, data, { excludeExtraneousValues: true })`
6. Fire webhooks non-blocking with `.catch()`
7. Import `WebhookModule` if needed (already exported from `WebhookModule`)

## Key Commands

```bash
pnpm install              # pnpm only (enforced via preinstall)
pnpm run start:dev        # hot-reload dev server on :3000
pnpm run build && pnpm run start:prod
pnpm run test             # Jest unit tests (rootDir: src/)
pnpm run prisma:migrate   # generate + apply migration
pnpm run prisma:generate  # regenerate Prisma client
pnpm run prisma:studio    # DB GUI
pnpm run lint             # eslint --fix
pnpm run format           # prettier
pnpm run test:watch       # jest watch
pnpm run test:cov         # jest coverage
cp .env.example .env      # first-time setup
```

Swagger UI: `http://localhost:3000/docs` (when `ENABLE_SWAGGER` resolves to true: explicit value, else only
`NODE_ENV=development|test`; resolved in `validateConfig()` from the raw `NODE_ENV`) — Prometheus metrics: `http://localhost:9091/metrics` (see Metrics)

## Metrics

`MetricsModule` from `@heyatom/nest-common/metrics` (global, `AppModule`): own `Registry` with default label
`app="fileharbor"`, default metrics, the HTTP histogram and the server. fileharbor's domain metrics live in
`src/modules/metrics/fileharbor-metrics.service.ts` (`FileharborMetrics`), registered on `MetricsService.registry`.

- `MetricsServer` serves `GET /metrics` on its own `node:http` server on `METRICS_PORT` (default `9091`), outside Nest: no route on the API port, no guards/throttler/CORS. Anything else → 404. One render is shared for 10s.
- Isolation is the network's job: never publish `9091` on the container, nginx never proxies it. Prometheus scrapes `fileharbor:9091` on the internal Docker network.
- `MetricsMiddleware` (all routes, applied by the package module) records `http_request_duration_seconds` (`method`/`route`/`status`). Middleware, not interceptor, so guard 401s and throttler 429s are counted. `route` is always the Nest route pattern (`/images/:id`), never the raw URL — media ids would explode cardinality; unmatched requests get `route="unmatched"`, requests the client abandons `status="499"`. `/health/*` is not instrumented.
- `fileharbor_video_processing_failures_total{stage}` (counter, `stage` = `thumbnail` | `metadata`, both pre-initialized to 0): incremented by `VideoService.uploadVideo` when ffmpeg thumbnail or ffprobe metadata extraction fails. The upload still returns 2xx (no thumbnail, duration/width/height stored as null), so HTTP metrics stay green — a missing `ffmpeg-static`/`ffprobe-static` binary or the 30s timeout only shows here. Alert: `increase(fileharbor_video_processing_failures_total[1h]) > 0`.
- `fileharbor_tinify_auto_total{result}` (counter, `result` = `compressed` | `skipped` | `failed`, pre-initialized to 0): `TinifyAutoJob` outcomes; `skipped` = the real file was already under the threshold. A day of `failed` with no `compressed` means a broken key. No alert rule.
- Optimize backlog gauges (label `kind` = `image` | `avatar`, both always present), lazy `collect()` — no query until scraped; a DB error logs `warn` and keeps the previous value. Aggregates only (`count` / `_min`), same predicates as the optimize jobs (`OPTIMIZE_RETRYABLE_WHERE` / `OPTIMIZE_GIVEN_UP_WHERE`, `storage.service.ts`):
  - `fileharbor_unoptimized_media{kind}` — rows the job will still retry (`isOptimized = false`, `optimizeAttempts < 3`).
  - `fileharbor_unoptimized_oldest_age_seconds{kind}` — `now - min(queued at)` over the same rows, `0` when there are none. Queued at = `createdAt` for images, `updatedAt` for avatars (a re-upload is an upsert that keeps the original `createdAt`). Alert: `fileharbor_unoptimized_oldest_age_seconds > 3*3600` for 30m (job stalled or behind: a failing row is given up after 3 hourly runs, so it can't hold this up).
  - `fileharbor_optimize_given_up{kind}` — rows the job stopped retrying (`optimizeAttempts >= 3`). Only leave via a reset (`POST admin/{images,avatars}/:id/reoptimize`, `…/reoptimize-failed`, or SQL `optimizeAttempts = 0`), deletion, or an avatar re-upload (which resets it), so it's a standing count, not an event. Alert: `fileharbor_optimize_given_up > 0` — fires until someone fixes/resets/deletes the rows; `increase()` would go silent after a day with the rows still broken.
- `fileharbor_storage_bytes{client}` — bytes of originals per client (images + videos + avatars, no thumbs or cached variants: same number as the console's `totalStorage`, via `storageUsageByClient`). Label = `Client.id` (immutable; `domain`/`name` can change), personal clients included. Lazy like the gauges above, three `groupBy` per scrape; reset after each successful query, so deleted clients drop out, while a failed one keeps the previous values. Says who grows, not how much disk is left. Alert: `delta(fileharbor_storage_bytes[24h]) > 5 GiB` for 1h (threshold to tune on prod).
- Alert rules for all of the above live in `monitoring/alerts.yml` (load it via `rule_files`). Change a metric or threshold → change it there too.

## Health

`/health/live` always 200. `/health/ready` (public, `@SkipThrottle`, outside `API_PREFIX`) checks:

- `database` — Prisma ping.
- `storage` (`health/storage-health.indicator.ts`) — `STORAGE_PATH` writable and at least
  `HEALTH_DISK_MIN_FREE_MB` (default 1024) free (`fs.statfs`, `bavail`). The response carries `freeMb` /
  `minFreeMb` and an errno code, never the path.

`MediaToolsCheck` (`health/media-tools.check.ts`) logs a `warn` at boot when the ffmpeg/ffprobe binaries
from `ffmpeg-static`/`ffprobe-static` are missing or not executable. It never blocks startup: only video
thumbnails/metadata need them.

## Bootstrap, logging, CORS

`main.ts` calls nest-common's `setupHttpApp`: `enableShutdownHooks`, `trust proxy` = `TRUST_PROXY_HOPS`
(default 0, **required in production**: behind nginx it is 1, or every client shares the throttler bucket of
the proxy), helmet, CORS, 5mb JSON limit, the global `ValidationPipe`. Helmet gets
`Cross-Origin-Resource-Policy: cross-origin` (`helmet` option): other sites embed our images and videos.
Outside production `upgrade-insecure-requests` is dropped from the CSP so `/docs` loads over plain http. `PORT` comes from the validated config only
(default 3000).

Logging is nest-common's `loggerParams`: the request id is always server-generated and returned as
`X-Request-Id` (errors included, also in the body); a well-formed inbound `X-Request-Id` is logged as
`clientRequestId`, never adopted or echoed. The `req` serializer passes the URL through `sanitizeLoggedUrl`
(`common/share-tokens.ts`): `?token=` and `/shared/:token` never reach the logs.

`CORS_ORIGIN` (`*` or a comma-separated origin list) is Joi-validated and read through `ConfigService` in
`main.ts`. **Required when `NODE_ENV=production`** — boot fails without it rather than defaulting to `*`;
elsewhere it defaults to `*` (an empty value counts as unset). `parseCorsOrigin` (`utils/cors.utils.ts`) parses it
for both Joi and `main.ts`: empty entries dropped, trailing `/` stripped, `*` mixed into a list rejected at boot.
Either goes to `setupHttpApp` as `corsOrigins` (`X-API-Key`/`X-User-Id` accepted, `X-Request-Id` exposed);
a list allows credentials, `*` does not (browsers refuse the combination).

## graphify

Knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain don't surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Docs

- [`docs/BACKLOG.md`](docs/BACKLOG.md) — lavoro da fare senza piano, bloccanti pre-deploy
- [`docs/external-album-api.md`](docs/external-album-api.md) — API album lato client (route, payload, errori, problemi noti)
- [`../docs/integrations/fileharbor.md`](../docs/integrations/fileharbor.md) — integration guide per altri servizi (fonte di verità)
- [`../docs/integrations/bastion.md`](../docs/integrations/bastion.md) — Bastion JWT/JWKS guide (importata sotto)
- [`../docs/standards/coding.md`](../docs/standards/coding.md) — NestJS conventions condivise

@../docs/integrations/bastion.md
