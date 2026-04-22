# Changelog

All notable changes to FileHarbor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

