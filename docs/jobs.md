# Scheduled jobs & Tinify

Dettaglio dei cron e della compressione Tinify. Riassunto in [`CLAUDE.md`](../CLAUDE.md).


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
hourly run picks them up; SQL (`optimizeAttempts = 0`) still works. The reset moves `updatedAt` too (`@updatedAt`): a new
ETag for images, and for avatars a fresh queued-at for `fileharbor_unoptimized_oldest_age_seconds`. Storage dirs map back to clients by `domain` **or** `id`
(`client.domain || clientId`); a dir matching neither is left alone.

Optimize jobs re-encode the original at `OPTIMIZE_QUALITY` (default 85, webp effort 4), not
`ORIGINAL_QUALITY` (default 100, uploads only), and write the new byte count to `size`
(`markAsOptimized(id, size)`). Rows optimized before that fix are realigned by the one-off
`src/scripts/backfill-media-size.ts` (in `src/` so it ships in `dist/`: in the container
`node dist/scripts/backfill-media-size.js [--apply]`, dry run by default). `src/scripts/backfill-image-dhash.ts`
(same shape, resumable on `dHash IS NULL`, `--rehash` redoes every row) fills `dHash` for images uploaded before plan 03 or emptied by the 256-bit migration. `src/scripts/regenerate-thumbnails.ts`
(same shape, `[--apply] [--client <id>]`) rebuilds every image thumb after a `THUMBNAIL_SIZE` / `THUMBNAIL_QUALITY` change,
which otherwise applies to new uploads only. `src/scripts/backfill-video-thumbnails.ts` (same shape, `[--apply] [--client <id>] [--force]`)
extracts `thumb.webp` for videos that have none: uploads made with an image built before 4.0.1 (no ffmpeg binary) kept
only `original.mp4`. Every `@Cron` job runs inside
`PrismaService.runExclusive()` (a `pg_try_advisory_lock` on its own connection), so with several
replicas a job runs on one of them; the others log a skip.

Tinify auto-compress is opt-in per client: `Client.tinifyAutoMinBytes` (`null` = off, set via
`PATCH /admin/clients/:id`; 1048576 is the suggested start) is both flag and threshold, and still needs
`tinifyActive` + a key. The job calls `ImageService.compressImageWithTinify`, so it shares the manual
endpoint's quota (`currentTinifyUsage`/`currentTinifyLimit`, reserved atomically before the call, raised to
Tinify's `Compression-Count`, set to the limit on a Tinify 429) and checks. At most
`TINIFY_AUTO_BATCH` (default 20) images per client per run, so the month's quota is spread. A failure bumps
`Image.tinifyAttempts` (skipped at `MAX_OPTIMIZE_ATTEMPTS`, reset by SQL); a 401, a 429, our own limit
(`code: TINIFY_LIMIT_REACHED`) or Tinify unreachable (no response, 60s timeout, 5xx) stops that client for
the run instead, so an outage never gives up on images. The manual endpoint refuses rows not yet `isOptimized`. A compression that saves nothing keeps
our file but still counts. Only `isOptimized` rows: the optimize job would re-encode a Tinify output.

