# Operations — errors, envelope, metrics, health, bootstrap

Contratto HTTP e osservabilità. Riassunto in [`CLAUDE.md`](../CLAUDE.md).

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
  (`X-FileHarbor-Fallback`).

## Response envelope & pagination (api.md §1–§2)

- nest-common's `TransformInterceptor` (`APP_INTERCEPTOR`, registered before `AuditInterceptor`, so `@Audit`
  metadata still sees the raw result) wraps every 2xx JSON body in `{ data }`. Never build the envelope by hand.
- Lists: the query DTO **extends** `PageParams` (`page`, `limit` ≤ 100, `skip` getter; never spread it), the
  service returns `paginate(items, total, params)` → `{ data, meta: { total, page, limit, totalPages } }`.
  Re-map items with `paginate(mapped, result.meta.total, query)`, not `{ ...result }` (loses the marker and
  gets wrapped twice). Admin list filters live on the DTOs in `admin/dto/admin-list-query.dto.ts`.
- Swagger: `@ApiOkData(X)` / `@ApiOkData([X])` / `@ApiCreatedData(X)` / `@ApiPaginatedResponse(X)`, never
  `@ApiResponse({ status: 200, type })`, which documents the bare DTO and misleads `@heyatom/client`.
- `@NoTransform()`: file and stream routes (`GET /images/:id`, avatar GETs, video `thumb`/`stream`, admin
  image `download`/`file`, admin video `thumb`/`stream`) and `health`. Their errors keep Nest's raw body. The
  `?info=true` JSON of `GET /images/:id` and of the avatar GETs is wrapped by hand (`{ data }`), so clients
  always read `.data`.


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
- `fileharbor_storage_bytes{client}` — bytes of originals per client. One collection is reused for
  `STORAGE_GAUGE_MEMO_MS` (60 s): three `sum(size)` scans per scrape were too much at a 15 s interval. (images + videos + avatars, no thumbs or cached variants: same number as the console's `totalStorage`, via `storageUsageByClient`). Label = `Client.id` (immutable; `domain`/`name` can change), personal clients included. Lazy like the gauges above, three `groupBy` per scrape; reset after each successful query, so deleted clients drop out, while a failed one keeps the previous values. Says who grows, not how much disk is left. Alert: `delta(fileharbor_storage_bytes[24h]) > 5 GiB` for 1h (threshold to tune on prod).
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

