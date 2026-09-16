# Changelog

All notable changes to FileHarbor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.0.0] – 2026-09-16

### Removed
- **`admin_users`, `admin_client_access` and `user_cache` tables, and the whole `/admin/auth/*`
  surface** (login, exchange, refresh, logout, me, profile, email and password endpoints, plus
  `GET /admin/auth/tenant/:slug`). Admin identity now lives entirely in Bastion; the console
  (Meridian) authenticates against Bastion and forwards the user token. `user_cache` was written on
  every admin request and read by nothing. `AdminInitService` is gone with them.
- `BASTION_TENANT_SLUG` and `FRONTEND_URL` env vars — only the deleted auth proxy used them.

### Added
- **Console permission checks in the service itself.** `AdminJwtGuard` now enforces the
  `fileharbor-*` permission claim that previously only Meridian's BFF checked, via
  `@RequirePermission(...)`. Fail-closed: a route behind the guard with no decorator is refused to
  everyone but `SUPER_ADMIN`.
- **`admin_principals` / `admin_identities`** — a table of exceptions, not a mirror of Bastion's
  users. A principal links the several Bastion `sub`s one person has (subs are per tenant) and may
  carry `fullAccess`. Rows are provisioned by SQL only; the service exposes no endpoint for them.
- **Personal clients** — `Client.ownerPrincipalId`, mutually exclusive with `bastionTenantSlug`
  (CHECK `clients_owner_xor_tenant`). A personal client is visible in the console only to its owner,
  `fullAccess` principals and `SUPER_ADMIN` included.

### Changed
- **Client scope no longer follows a role.** Every caller sees the clients mapped to the tenant in
  their token; `SUPER_ADMIN` alone no longer widens that. Cross-tenant reach comes from a principal
  with `fullAccess`. A caller with no principal row is no longer rejected (`401 Admin access not
  granted` is gone) — they are simply scoped to their tenant.
- **Admin bookmarks are keyed on `actorId`** (principal id, else `sub:<sub>`) instead of
  `adminUserId`, so a linked person keeps one set across tenants. The bookmark response field is
  renamed `adminUserId` → `actorId`.
- `POST /admin/clients` defaults `bastionTenantSlug` to the creator's tenant; creating a client with
  no mapping is allowed only for a `fullAccess` principal and otherwise responds `400`.

### Migration
Two migrations, in order: `20260916100000_admin_principals` adds and backfills (every active admin
with `allClientsAccess` becomes a `fullAccess` principal, bookmarks are re-keyed), then
`20260916100100_drop_admin_users` drops the old tables. Admins scoped through `admin_client_access`
get no principal: check that list before deploying. Personal clients must be assigned an owner by
hand — see `CLAUDE.md`.

---

## [2.8.0] – 2026-09-15

### Added
- **`POST /admin/clients`** – create a new client from the admin console (SUPER_ADMIN only; other
  roles get `403 Forbidden`). Accepts `name` (required), `domain`, `active` and `bastionTenantSlug`
  (all optional). Response is `AdminClientResponseDto` plus the plaintext `apiKey`, returned **only**
  on this endpoint — every other client response masks or omits it. A `domain` or `bastionTenantSlug`
  already used by another client responds `409 Conflict`.

---

## [2.7.1] – 2026-09-15

### Fixed
- Fixed application startup when loading `StatisticsModule` by consuming the `AdminJwtGuard` exported by
  `AdminAuthModule`, including its `BastionTokenVerifier` dependency.

---

## [2.7.0] – 2026-09-14

### Added
- **Self-service avatars (`/me/avatar`)** – Bastion user-JWT endpoints so Meridian console users can manage
  their own avatar without an API key.
  - `GET /me/avatar` – `{ enabled, avatar }`; `avatar` is `null` (not a 404) when none uploaded yet.
  - `PUT /me/avatar` – multipart `file` field (PNG/JPEG/WebP/GIF, 5 MB limit) → `AvatarResponseDto`.
  - `DELETE /me/avatar` – deletes the caller's own avatar.
  - `externalUserId` is always the verified token `sub`, never taken from body/headers.
  - `BastionUserJwtGuard` (new) – verifies the Bastion user JWT (signature + `appSlug`) but, unlike
    `AdminJwtGuard`, does **not** require a local `AdminUser` row. Token verification itself was extracted
    into a shared `BastionTokenVerifier` used by both guards.
- `Client.bastionTenantSlug` (nullable, unique) – explicit mapping from a Bastion tenant slug to the
  FileHarbor client that owns its self-service data. A tenant with no mapping (e.g. a "personal" client)
  never gets self-service avatars — `/me/avatar` responds `422` for `PUT`/`DELETE`, and `enabled: false` for `GET`.
  Settable via `PATCH /admin/clients/:id` (`bastionTenantSlug`, admin-only); a duplicate mapping responds `409`.

### Changed
- `AdminClientResponseDto` (admin client list/show) now includes `bastionTenantSlug`.

---

## [2.2.3] – 2026-04-23

### Added
- Added new admin API for show single user details
- Added new admin API for adding image to an album
- Added new admin API for for creating an album
### Changed
- Separated admin tags and users in dedicated controllers and services to improve code organization and maintainability.


---

## [2.2.2] – 2026-04-22

### Added
- Added new runner for wiki
- Added new admin API for list users
- Added new param for user name on upload file

---

## [2.2.1] – 2026-04-22

### Changed
- Fix Prisma import for admin service.

---

## [2.2.0] – 2026-04-22

### Added
- **Admin module** – full admin portal with JWT-based Bearer token auth (separate from client `X-API-Key` flow).
  - `AdminJwtGuard` + `@AdminUser()` decorator for protected endpoints.
  - `AdminInitService` auto-seeds first `SUPER_ADMIN` on startup from `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` env vars.
  - Roles: `SUPER_ADMIN` / `ADMIN`; `allClientsAccess` + `allowedClientIds` authorization model.
  - Auth endpoints: `POST /admin/auth/login`, `POST /admin/auth/refresh` (httpOnly cookie rotation), `POST /admin/auth/logout`.
  - Cross-client CRUD for images, avatars, albums, and clients.
  - Admin image upload on behalf of any accessible client.
  - Separate profile management: `GET/PATCH /admin/auth/me`, `POST /admin/auth/me/change-password`.
  - Global and per-client statistics endpoint.
  - Tag listing with optional search/limit filters.
- `AGENTS.md` updated with Admin Module section and module map entry.

---

## [2.1.2] – 2026-04-14

### Changed
- Client lookup logic moved from controller into service layer (`client.service.ts`).
- Updated GitHub Actions builder workflow.
- Dependency updates.

---

## [2.1.1] – 2026-03-31

### Added
- Image upload count included in client statistics response.
- Base URL logged at application startup.

### Fixed
- Album list endpoint no longer returns embedded image file data (only metadata).

---

## [2.1.0] – 2026-01-27

### Added
- Discord webhook notifications revamped: richer embeds, new `WebhookEvent` enum entries.
- Client statistics moved under the `/client` route namespace.

---

## [2.0.5] – 2026-01-26

### Added
- Basic unit/integration test suite (`album.service.spec.ts` and related).
- Default fallback images added to `storage/defaults.fileharbor/` (`fileharbor_not_found.webp`, `fileharbor_permission_denided.webp`, etc.).
- Path validation enforced before file upload (`StorageService.validatePath()`).
- `sanitizePathComponent()` updated to allow dots in domain names.

### Fixed
- `GET /images/:id` now returns fallback error images instead of 4xx for non-`info` requests.
- Docker image permission issue resolved.

### Changed
- Job module cleanup refactored (cron decorators temporarily commented out; re-enable with `@Cron(CronExpression.EVERY_HOUR)`).
- Dependency updates.

---

## [2.0.4] – 2026-01-20

### Fixed
- Docker image source location corrected.
- Dockerfile user configuration updated.

---

## [2.0.3] – 2026-01-19

### Added
- `fullPath` field exposed in image response DTO.
- Cache-busting `t` query parameter support for image URLs.

---

## [2.0.2] – 2026-01-15

### Added
- Discord webhook system (`WebhookModule`, `WebhookService`, `WebhookEvent` enum).
- External album ID support (`albumId` settable by client at creation time).
- Image orphan cleanup job.
- `X-User-Id` / `externalUserId` is now optional on upload (defaults to reserved `system` user).

### Changed
- Prisma client regenerated and re-initialized; client output path fixed to `generated/prisma/`.
- HTTP exception filter improvements.
- Original image quality settings improved.
- Auto-thumbnail background service removed (thumbnails generated on upload).
- Image serve pipeline optimized for speed.
- Environment variable documentation updated.

### Fixed
- Prisma build errors resolved.

---

## [2.0.1] – 2026-01-14

### Added
- API Key authentication (`X-API-Key` header) replaces `X-Client-Id` header — **breaking change**.
- `system` user auto-created alongside every new client.
- User avatar logic updated to use `externalUserId`.
- Application-level logging implemented.
- Swagger docs fixed for multipart image upload.

### Changed
- Project restructured into `src/modules/` directory layout.
- Storage path logic improved (domain-based directory scoping).
- Status controller now resolves `clientId` from API key token.
- Prisma refactored after ORM update.
- Dev seed removed.

---

## [2.0.0] – 2025-10-29 → 2026-01-14

### Added
- Initial FileHarbor 2.0 rewrite on NestJS 10 + Prisma + PostgreSQL.
- Multi-tenant architecture scoped by `clientId`.
- Image upload with automatic WebP conversion via Sharp.
- On-demand resizing and format conversion.
- Avatar system (one per user).
- Album system with public/private access and token-based sharing.
- Scheduled optimization jobs (EXIF removal, compression, WebP conversion).
- Swagger UI at `/docs`; Prometheus metrics at `/metrics`.
- Rate limiting via `@nestjs/throttler`.
- Dockerfile and GitHub Actions CI workflow.

---

[2.2.1]: https://github.com/atombolato/fileharbor/compare/v2.2.1...HEAD
[2.2.0]: https://github.com/atombolato/fileharbor/compare/v2.2.0...HEAD
[2.1.3]: https://github.com/atombolato/fileharbor/compare/v2.1.2...HEAD
[2.1.2]: https://github.com/atombolato/fileharbor/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/atombolato/fileharbor/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/atombolato/fileharbor/compare/v2.0.5...v2.1.0
[2.0.5]: https://github.com/atombolato/fileharbor/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/atombolato/fileharbor/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/atombolato/fileharbor/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/atombolato/fileharbor/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/atombolato/fileharbor/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/atombolato/fileharbor/releases/tag/v2.0.0
