# Changelog

All notable changes to FileHarbor are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

Rebuild the image, no migration. Placeholder images moved from `storage/defaults.fileharbor/` into the
image (`defaults/`): the storage volume no longer needs them (the old dir can be deleted).

### Fixed
- **Placeholders shipped with the image.** A fresh storage volume turned every public 404/403 into a 500.
  Read once and memoized.
- **500 bodies no longer carry the storage path.** Disk/sharp failures answered with the OS message
  (`ENOENT: ... '/srv/storage/<domain>/images/<id>/original.webp'`); now a generic message, detail in the log.
- **Avatar ETag** includes `updatedAt`: a browser revalidating after a re-upload used to get 304 forever.
- **Avatar re-upload** no longer deletes the old files first: no 404 window, and an encode failure keeps
  the old avatar instead of a row pointing at an empty dir.
- **Video views** counted one per playback (first Range request), buffered and flushed every 10s like
  image views, instead of one `UPDATE` per Range chunk.
- **Upload into an unknown album is a clean 404.** `POST /images` / `POST /videos` with an `albumId` that
  doesn't exist in the client used to write the file and the row first, then 404: the asset existed and a
  retry duplicated it. The album is now checked before anything is written.
- **Optimize jobs write nothing until both files are encoded.** A thumb failure used to leave the original
  already re-encoded but not marked, so the next run re-encoded a q85 file again (up to 3 times). Now the
  thumb is encoded first and the original is written last.
- **One album order.** Uploads with `albumId` go through the same code as `POST /albums/:id/items`: the
  first item of an empty album is `0` (uploads used to start at `1`).
- **Share links and album tokens: limits and codes.** `POST /images/:imageId/share` refuses a public image
  (`400 IMAGE_NOT_PRIVATE`, as the console does: a link on a public image would silently grant access the
  day it turns private) and an `expiresAt` more than 365 days out. `expiresInDays` on album tokens is
  capped at 365 (`1e15` was a 500) and defaults to 7 (it used to mean "never"). An expired share link
  and an expired album token both answer `403` with a domain code (`SHARE_LINK_EXPIRED` /
  `TOKEN_EXPIRED`); the share link one used to be a `400` swallowed into a bare `403`.
- **`PATCH /admin/videos/:id` validates its body** (`AdminUpdateVideoDto`, same rules as images): the inline
  type let any `originalName` length through and turned a string `tags` into one tag per character.
- **Video upload temp files are always removed.** Multer writes up to `MAX_VIDEO_SIZE` to the tmpdir before the
  handler; a `400` from validation or an admin `403` left it there. An interceptor on both upload routes
  now unlinks it however the request ends.
- **Tinify output URL pinned to `https://api.tinify.com`.** The compressed file was downloaded, with the
  client's Tinify key, from whatever URL the upstream JSON named; any other origin is now refused.

### Changed
- **One render per variant.** Concurrent first hits on the same uncached variant or blurred preview used to
  render it once each behind the semaphore; now they share one render.
- **Small variants come from the thumb.** A variant that fits inside `THUMBNAIL_SIZE` (and is not q100) is
  cut from `thumb.webp` instead of decoding the original: the common `srcset` widths cost ~10x less.
- **One query less per public image.** The storage dir comes from a 30 s cache in `ClientService`, not a
  relation load on every `GET /images/:id`.
- `sharp.concurrency` set to `cpus / RENDER_CONCURRENCY`; `UV_THREADPOOL_SIZE=8` in the Docker image.
- `fileharbor_storage_bytes` reuses its collection for 60 s across scrapes.
- Album item lists run their two reads in parallel; the shared-album route drops a duplicate token lookup.
- **On-disk images are streamed, not buffered.** `GET /images/:id` used to `readFile` the whole file into
  memory; now `createReadStream` (or `X-Accel-Redirect` when enabled). A row whose file is gone is a 500
  and not a view.
- Per-asset "served" log lines (images, avatars) demoted to `debug`.
- `keepAliveTimeout` 65s / `headersTimeout` 66s, above nginx's upstream keepalive.
- Job lock connection has a 5s connect timeout.
- Video stream drops a redundant client lookup.

---

## [4.1.2] – 2026-10-30

Rebuild the image: nothing else to deploy, no migration.

### Fixed
- **`?blur=1` honors `format`.** `jpeg`/`png` used to come back as WebP; the blurred preview is now
  converted per request (not cached, behind the render limiter). `blurred.webp` stays the stored file.

### Changed
- **`?blur=1` honors `width`/`height`.** Snapped like other variants and only ever downscaled: sizes from
  480 px up are dropped, since the preview is already that size. `thumb` and `quality` stay ignored.
- **Blur ETag** carries the transform (`blur-<w>-<h>-<format>`) when one applies; plain `blur` otherwise,
  so existing cached previews keep their ETag.

---

## [4.1.1] – 2026-10-29

Rebuild the image: nothing else to deploy, no migration.

### Changed
- **Blurred preview generated only where it is shown.** Upload pre-generates `blurred.webp` only for
  private or `blurPublic` images; public ones get it lazily on the first `?blur=1`. A `PATCH` (client or
  admin) that leaves an image private or `blurPublic` builds a missing one after the response. Regenerate
  rebuilds it only if it already exists. Existing files are left in place.

---

## [4.1.0] – 2026-10-29

**Migration**: `20261029120000_image_blur_public` (adds `images."blurPublic"`, default `false`). The image
ships no migrations: apply it before starting the new container.

### Added
- **Blurred preview** (plan 11): `GET /images/:id?blur=1` serves `blurred.webp`, a 480 px blurred
  rendition built from the thumb. Same access as the original, unless the owner sets `blurPublic`
  (upload or `PATCH /images/:imageId`, audited), which serves the preview to anyone. Pre-generated on
  upload and rebuilt by regenerate; never falls back to the original (`422`/`503`), never counts as a view.

### Fixed
- Storage: `fileExists` now goes through `validatePath`, and `.`/empty path components are rejected
  (hardening, not reachable from the API).

### Changed
- Docker image drops runtime-dead dependencies (prisma CLI, other databases' query compilers, foreign
  ffprobe binaries, musl libvips): amd64 image 1.52 GB → 533 MB.

## [4.0.1] – 2026-10-28

Rebuild the image: nothing else to deploy, no migration.

### Fixed
- **Video thumbnails and metadata failed on every upload** (`spawn …/ffmpeg-static/ffmpeg ENOENT`, alert
  `fileharbor_video_processing_failures_total`). pnpm 10.14 ignored `allowBuilds` and the `.npmrc`
  `onlyBuiltDependencies`, so ffmpeg-static's postinstall never downloaded the binary into the image.
  Build approvals now live in `pnpm-workspace.yaml` as `onlyBuiltDependencies` / `ignoredBuiltDependencies`.

---

## [4.0.0] – 2026-10-27

**Breaking**: API contract v1 (heyatom platform plan 02, `docs/platform/plans/02-api-contract-cutover.md`).
Deploy **FileHarbor together with its consumers** on `@heyatom/client` ^1.0.0 (articuno, beacon,
shelfie-api, almanac, dbdbuilds-api) and Meridian ≥ 2.0.0: old consumers break on the new shapes.
No migration.

### Changed
- **Envelope**: every 2xx JSON response is `{ data }` (global `TransformInterceptor`). Files, streams
  and `/health` are untouched (`@NoTransform()`); the `?info=true` JSON branch of image/avatar GETs is
  `{ data: metadata }`.
- **Pagination**: `perPage` → `limit` (default 20, max 100; tags max 500);
  `{ data, pagination: { page, perPage, total, totalPages } }` → `{ data, meta: { total, page, limit, totalPages } }`
  on every list (images, videos, albums, album items, creators and their admin counterparts, bookmarks).
- Admin list routes read DTOs instead of raw query params; admin `sortBy` / `sortOrder` on images and
  videos are validated (unknown value → 400 instead of a silent fallback).
- Share links are paginated by the DB query, not sliced in memory.
- OpenAPI documents the envelope (`ApiOkData` / `ApiCreatedData` / `ApiPaginatedResponse` from
  `@heyatom/nest-common` 0.4.0).

### Fixed
- **Throttling**: calls with a valid client API key skip the per-IP throttler. Batches from one service
  IP (e.g. a 34-file upload) no longer hit 429; missing or invalid keys stay IP-throttled.

### Dependencies
- Dependency updates.

---

## [3.6.1] – 2026-10-25

Deploy **FileHarbor first**, then Meridian (Meridian's `?dHash=` filter now expects 64 hex chars). One
migration runs at boot and empties every `dHash`: until `backfill-image-dhash.js --apply` has run, the
duplicates page is empty.

### Fixed
- **Duplicate detection grouped different images.** `dHash` went from 64 to 256 bits (17x16 grid, 64 hex
  chars): at 9x8, icons sharing a frame (e.g. game perks) all hashed alike. Column `CHAR(64)`,
  `?dHash=` and the 400 message follow. `backfill-image-dhash.js` gains `--rehash` (every row, not only
  `NULL` ones).
- **Security**: body-parser and multer bumped for HIGH CVEs (CVE-2026-111181, CVE-2026-113872); multer
  through a pnpm override until `@nestjs/platform-express` bumps it.

---

## [3.6.0] – 2026-10-24

Deploy **Meridian first**, then FileHarbor (see Removed). Four migrations run at boot. After the
deploy, run `backfill-media-size.js` and `backfill-image-dhash.js` (dry run, then `--apply`).

### Added
- **Automatic Tinify compression.** `TinifyAutoJob` compresses, hourly and largest first, the
  optimized images above a per-client threshold (`tinifyAutoMinBytes` on
  `PATCH /admin/clients/:id`, `null` = off), within the monthly quota. A Tinify outage stops the
  client for that run without counting attempts; a per-image failure counts in `tinifyAttempts`
  (given up at 3).
- **Share links from the console** — `admin/image-share-links`: list, create and revoke an image's
  share links. Creating one requires a private image and an expiry within 365 days.
- **Duplicate images** — `Image.dHash` (perceptual hash, computed on upload).
  `GET /admin/images/duplicates` groups by client and hash (`crossClient=true` for `fullAccess`
  only), `GET /admin/images?dHash=` lists one group. Never deletes on its own.
- **Storage report** — daily `storage_snapshots` per client × kind (`StorageSnapshotJob`, 00:30 UTC).
  `storageByKind` and `dailyChart[].storage` on `GET /admin/stats`, plus `GET /admin/stats/storage`
  and `GET /admin/stats/storage/creators`.
- **`POST /admin/images/:id/regenerate`** — rebuilds the thumbnail from the stored original and drops
  cached variants. Id, original and size are untouched. Bulk version for a `THUMBNAIL_SIZE` change:
  `node dist/scripts/regenerate-thumbnails.js [--apply] [--client <id>]`.
- **Retry optimization from the console** — `POST /admin/images/:id/reoptimize`,
  `POST /admin/images/reoptimize-failed` and the same for avatars: reset `optimizeAttempts` so the
  hourly job picks the rows up again. `optimizeStatus` filter on the lists.
- **`srcset` in image responses** — absolute URLs on fixed widths (320–1920) below the original,
  then the original. Public images only, also on album items.
- **`isPrivate` on `PATCH /images/:id`.**
- **Metric `fileharbor_storage_bytes{client}`** and alert `FileHarborClientStorageGrowth`
  (> 5 GiB in 24h). Reload `monitoring/alerts.yml`.
- **Audit on the client surface** — `DELETE` of images, videos, avatars and albums, and `isPrivate`
  changes through `PATCH /images/:id` and `PATCH /videos/:id`, write `fh_*` events to Bastion with
  `via: "api_key"`, `clientId` and the `X-User-Id` that made the call.

### Changed
- `size` stays in step with the file after the optimize job re-encodes it (it kept the upload's
  byte count). Existing rows: `backfill-media-size.js`.
- The Tinify quota is reserved atomically and synced with the key's real count
  (`Compression-Count`). A Tinify `429` marks the client's quota as used up until the monthly reset.
- Manual Tinify compression refuses an image that hasn't been optimized yet: the optimize job would
  re-encode the paid result.
- Tinify calls time out after 60s.
- The console surface skips the IP throttler: Meridian calls from one IP for every admin.

### Fixed
- Owner checks on share links and video updates compared `X-User-Id` with the internal creator id.
- JPEGs that libjpeg only warns about ("Invalid SOS parameters") are accepted.
- `PATCH /images/:id` with `isPrivate: null` is a `400`, not a `500`.

### Removed
- **Per-client Discord webhooks.** The `webhookEnabled` / `webhookUrl` columns are dropped, and
  `PATCH /admin/clients/:id` answers `400` if it receives them, which is why Meridian goes first.
  FileHarbor has no outgoing notifications any more; consumers poll.

---

## [3.5.0] – 2026-10-22

### Added
- **`POST /admin/images/bulk-delete`** — up to 100 ids in one request, answers
  `{ deleted, failed }`. Missing and out-of-scope ids both read as "Image not found". The console
  used to loop single `DELETE`s and hit the throttler (`429`).
- **`search` on `GET /admin/avatars`** — case-insensitive contains-match on the creator's username
  or `externalId`. `creatorId` stays an exact external id match and combines with it.

### Changed
- **Animated GIF/WebP uploads stay animated.** sharp read only the first frame, so they were stored
  as a static WebP. Original, thumb, WebP variants and the optimize jobs now keep every frame;
  JPEG/PNG renders take the first frame, `getImageMetadata` reports one frame's height, and
  `MAX_INPUT_PIXELS` counts all frames together.
- Tinify refuses animated originals: it would overwrite them with a single frame.

---

## [3.4.0] – 2026-10-21

### Added
- **`isPrivate=true|false` on `GET /admin/images` and `GET /admin/videos`** — privacy filter
  applied to the query, so pagination and totals follow it. Meridian used to filter one page
  client-side. Any other value is a `400`.

### Fixed
- **`GET /admin/images/:id` and `PATCH /admin/images/:id` return `creator.id`.** The DTO declared it,
  the query never selected it, so the console could not link an image to its creator.
- **No throttling on `GET /admin/images/:id/file`, video thumb and video stream.** A Meridian grid
  embeds dozens of them from one IP, and the 10/min default answered `429` past the first tiles.

---

## [3.3.1] – 2026-10-21

### Added
- **`GET /admin/images/:id/file?thumb=`** — image bytes inline for the console (Meridian), private
  images included. Same auth, scope and permission as `:id/download`, but counts neither a view nor
  a download, sends no `Content-Disposition`, and answers `Cache-Control: private, max-age=300` +
  `X-Content-Type-Options: nosniff`. No placeholder: no access is a `403`.

### Changed
- `@heyatom/bastion-client` 0.9.0.

---

## [3.3.0] – 2026-10-16

### Added
- **`GET /avatars/:clientRef/:externalUserId`** — `clientRef` is the client's domain or id. Every
  avatar URL FileHarbor returns now uses this form.
- **Bounded on-demand image variants.** On `GET /images/:id`, width/height snap up to a fixed grid
  (16 … 4096) and quality to 40/60/75/85/100. At most 20 cached variants per image, and renders go
  through a semaphore (`RENDER_CONCURRENCY`, `RENDER_QUEUE_LIMIT`). When it is full the response is
  `503` with `Retry-After: 1`.
- **`/health/ready` storage check**: `STORAGE_PATH` writable with `HEALTH_DISK_MIN_FREE_MB` free.
  At boot, a `warn` is logged when the ffmpeg/ffprobe binaries are missing.
- **`monitoring/alerts.yml`** with the Prometheus alert rules for the metrics.
- **Global `ThrottlerGuard`**: it was configured but never enforced. Health probes and public media
  delivery skip it.
- **`ENABLE_SWAGGER`** gates `/docs`. Default on only for an explicit `NODE_ENV=development|test`.
- **`X-Request-Id`** response header on every request, errors included. A well-formed inbound
  `X-Request-Id` is logged as `clientRequestId`.
- `IMAGE_X_ACCEL_REDIRECT` (opt-in): on-disk image files handed to nginx.
- CI workflow (lint, build, tests) and a committed `openapi.json`, checked against
  `pnpm openapi:dump`.

### Changed
- **Error body** (nest-common `AllExceptionsFilter`): `{ statusCode, code, message, errors?,
  requestId }`; `timestamp` and `path` are gone. Prisma `P2002`/`P2003` → 409, `P2025` → 404.
  Scanner 404s now get a response instead of hanging.
- **Bootstrap through nest-common `setupHttpApp`**: helmet (`Cross-Origin-Resource-Policy:
  cross-origin`), shutdown hooks. `trust proxy` now comes from `TRUST_PROXY_HOPS` (default 0, set to
  1 behind nginx) instead of a hardcoded value. Metrics, logging and tag pagination come from the
  package too.
- **`CORS_ORIGIN`** is Joi-validated and required in production. It accepts a comma-separated list
  and rejects `*` mixed into a list.
- **`API_PREFIX`** drives both the served routes and every returned URL (default empty). Returned
  URLs no longer carry a hardcoded `/v2`.
- **`GET /avatars/:externalUserId` is deprecated** (`Deprecation: true`). Without an API key it
  serves only an id that exactly one client has.
- `webhookUrl` must be a Discord webhook URL, checked on write and before each send. Redirects are
  not followed, and the token is masked in admin responses.
- `POST /admin/clients` requires a lowercase dotted hostname as `domain`.
- Without `fullAccess`, `bastionTenantSlug` can only be the caller's own tenant or `null` (`403`).
- Optimize jobs re-encode at `OPTIMIZE_QUALITY` (default 85, webp effort 4). Uploads keep
  `ORIGINAL_QUALITY`.
- Every `@Cron` job runs under a Postgres advisory lock, so with replicas it runs once.
- Deletes remove the DB row first, then the files. The nightly sweep also cleans orphaned video dirs.
- Performance: `GET /images/:id` loads the image once, buffers view counts and answers
  `If-None-Match` with a `304`. API keys are cached for 30s, album item writes are batched, and
  admin stats are aggregated in SQL.
- `@heyatom/nest-common` 0.3.0, `@heyatom/bastion-client` 0.8.0. Dropped bcrypt, cookie-parser,
  uuid and jose.

### Removed
- `GET /client/admin/stats` (`X-Admin-Secret`) and `ADMIN_SECRET`: replaced by `GET /admin/stats`.
- `VideoCleanupJob`, which never ran.

### Fixed
- **Security**:
  - Private and token-gated images were sent `public, immutable`. They now get
    `private, no-store`.
  - Avatar lookups weren't scoped by client.
  - Resize dimensions are bounded and the output format is whitelisted. Upload size and decoded
    pixels (100 MP) are capped, and the real image format is checked.
  - API keys and share tokens are kept out of the logs.
  - `validatePath` let a sibling directory pass.
  - `Content-Disposition` filenames are sanitized.
  - Storage dirs that map to two clients are skipped by the sweep.
- Owners could not read their own private images.
- `shareUrl` pointed at a 404 (`/images/shared/<token>`).
- Body-parser errors (`413` and similar) came back as `500`.
- Video streams sent `Cache-Control: public`. They are now `private`.
- A missing video file answered `500`, and an open-ended range was capped at 1 MB.
- Per-client and admin `totalStorage` left out video and avatar bytes.
- A failing dir stopped the orphan sweep for the rest of its domain.
- Migration `20260625203420_mixed_albms` dropped `album_images` without copying the rows.
  `scripts/recover-album-items.sql` restores them from a backup.

### Migration
`20261008104503_index_cleanup` and `20261014120000_video_size_bigint` (`Video.size` becomes BigInt).

New env vars: `TRUST_PROXY_HOPS` (required in production behind nginx), `CORS_ORIGIN` (required in
production), `ENABLE_SWAGGER`, `API_PREFIX` (keep it empty behind nginx: the public prefix goes in
`BASE_URL`), `OPTIMIZE_QUALITY`, `RENDER_CONCURRENCY`, `RENDER_QUEUE_LIMIT`,
`HEALTH_DISK_MIN_FREE_MB`, `DATABASE_POOL_MAX`.

---

## [3.2.0] – 2026-10-06

### Added
- **Optimize backlog gauges.** `fileharbor_unoptimized_media{kind}`,
  `fileharbor_unoptimized_oldest_age_seconds{kind}` and `fileharbor_optimize_given_up{kind}`
  (`kind` = `image` | `avatar`). They are computed on scrape with the optimize jobs' own predicate,
  so rows the job gave up on move to `given_up` (needs manual attention) instead of keeping the
  backlog alert firing.
- **`fileharbor_video_processing_failures_total{stage}`**: ffmpeg thumbnail and ffprobe metadata
  failures. The upload still returns 2xx.
- **Avatars as PNG/JPEG via `?format=`** (Satori can't decode WebP). The default WebP path is
  unchanged.
- `pnpm openapi:dump` writes the OpenAPI document, which `@heyatom/client` uses for type generation.
- Swagger response types for admin lists and album items, and the `PATCH /admin/videos/:id` body.

### Changed
- **Prometheus metrics moved off the API port.** `GET /metrics` is no longer served on `PORT`.
  It listens on `METRICS_PORT` (default `9091`), on the internal network only, so update the scrape
  target to `fileharbor:9091`. `@willsoto/nestjs-prometheus` is replaced by `@prometheus-io/client`,
  and the `app="fileharbor"` label is kept. Adds `http_request_duration_seconds`.
- **Logging switched to pino** (same setup as Bastion): pretty output in development, JSON in
  production. Share tokens and auth headers are kept out of the logs. `LOG_LEVEL` takes pino levels.
- sharp 0.35, TypeScript `module=node20`.

### Fixed
- **Optimize queue could freeze.** The hourly image/avatar optimize jobs took 50 unoptimized rows
  in no particular order and never recorded failures, so 50 broken files (missing original,
  corrupt, sharp error) filled every batch forever. Rows are now taken oldest first, and each
  failure increments the new `optimizeAttempts` column. After 3 the row is skipped (reset to `0`
  to retry).
- **Re-uploaded avatar inherited the old one's failed attempts.** Replacing an avatar now resets
  `optimizeAttempts` to `0`, so a new file isn't skipped because the previous one was broken. The
  backlog age for avatars uses `updatedAt`, so a re-upload doesn't read as days old.
- **Orphaned files of domainless clients were never cleaned.** The nightly storage cleanup mapped
  storage dirs to clients by `domain` only, but a client without a domain stores under its id. It
  now matches either. Known images are loaded once per client instead of one unindexable
  `endsWith` query per directory.

### Migration
`20261006120000_optimize_attempts`.

---

## [3.1.1] – 2026-09-23

### Changed
- Admin and self-service auth built on `@heyatom/bastion-client` (^0.3.1). The token issuer is now
  checked (`iss === 'bastion'`), and the JWKS TTL default drops from 1h to 5 min.
  `AdminJwtPayload`/`BastionUserPayload` `email`, `username` and `image` are `string | null`.

### Fixed
- Docker build: pnpm 10.14.0 with `--frozen-lockfile`, so dependencies are no longer re-resolved at
  build time.

---

## [3.1.0] – 2026-09-16

### Changed
- **`User` renamed to `Creator`** (breaking for the admin API and webhooks):
  - `users` → `creators`, `externalUserId` → `externalId`, `userId` → `creatorId` on images,
    videos, avatars and albums.
  - `/v2/users` → `/v2/creators` and `admin/users` → `admin/creators`, with no alias.
  - `ImageResponse.user` → `creator`, `AvatarResponse.userId` → `creatorId`, `?userId=` →
    `?creatorId=`, webhook `data.userId` → `data.creatorId`.
  - `totalUsers`/`newUsers` → `totalCreators`/`newCreators` in `GET admin/stats` and in the client
    responses.
  - Audit events `fh_user.*` → `fh_creator.*`.
  - `X-User-Id`, the `externalUserId` avatar field and `/v2/avatars/:externalUserId` are unchanged.
- **Bastion auth moved to `src/modules/bastion/`.** JWKS is verified with `jose`, with a cache
  keyed on `kid`, so a key rotation no longer rejects tokens for up to an hour. `AdminJwtGuard` →
  `BastionUserGuard`, `@AdminUser` → `@CurrentAdminUser`.

### Added
- **Console writes audited to Bastion** with `@Audit()` (`fh_` event names) and
  `admin.access_denied` from the guard. Writes are fire-and-forget, and without
  `BASTION_CLIENT_API_KEY` they are skipped.

### Migration
`20260916110000_rename_user_to_creator`: renames only, no data copied.

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
