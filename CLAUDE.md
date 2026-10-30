# FileHarbor – Claude Code Guide

Multi-tenant image/video/avatar API. **NestJS 11 + Prisma + PostgreSQL + Sharp + pnpm** (never npm/yarn).
Shared runtime from `@heyatom/nest-common` (filter, envelope, metrics, Swagger, bootstrap), Bastion auth from
`@heyatom/bastion-client`. Path alias `@/*` → `src/*`. Swagger at `/docs` when `ENABLE_SWAGGER` resolves true.

Detail lives in `docs/` — this file is the map, not the manual:

| Topic | Doc |
|---|---|
| Admin console auth, permissions, client scope, principals, audit, `/me` | [docs/admin-console.md](docs/admin-console.md) |
| Cron jobs, optimize retries, Tinify auto-compress | [docs/jobs.md](docs/jobs.md) |
| `GET /images/:id`: variants, blur, srcset, regenerate, `API_PREFIX`/`BASE_URL` | [docs/image-delivery.md](docs/image-delivery.md) |
| Errors, `{ data }` envelope, pagination, metrics, health, bootstrap/CORS/logging | [docs/operations.md](docs/operations.md) |
| Client-side album API | [docs/external-album-api.md](docs/external-album-api.md) |
| Backlog · reviews · plans | [BACKLOG](docs/BACKLOG.md) · [reviews](docs/reviews/README.md) · [plans](docs/plans/README.md) |
| Integration guide for other services (source of truth) | [../docs/integrations/fileharbor.md](../docs/integrations/fileharbor.md) |

## Modules (`src/modules/`)

| Module | Role |
|---|---|
| `client` | `X-API-Key` auth, tenant resolution, creator identity, `ClientThrottlerGuard` |
| `image` / `video` / `avatar` / `album` / `tag` / `creator` | Domain CRUD, share links, album tokens |
| `storage` | All disk I/O and Sharp processing — never build paths by hand |
| `admin` + `statistics` + `bookmarks` | Console API (`admin/*`, `admin/stats`, per-actor bookmarks), Bastion user JWT |
| `bastion` | Token verifier, `BastionUserGuard`, `BastionSelfServiceGuard`, console permissions |
| `me` | End-user self-service avatar |
| `metrics` / `health` | `FileharborMetrics` on nest-common registry, readiness checks |

## Three auth surfaces — never mix them

1. **Client (`X-API-Key` + `X-User-Id`)** — every non-`@Public()` controller runs `ClientInterceptor`
   (`client/interceptors/client.interceptor.ts`): sets `request.clientId`, `request.externalCreatorId`.
   Read with `@ClientId()` / `@CreatorExternalId()`. `X-Client-Id` is **not** accepted. Valid key skips
   the throttler.
2. **Console (`Authorization: Bearer <Bastion user JWT>`)** — `BastionUserGuard` verifies RS256 via JWKS,
   checks `appSlug ∈ ADMIN_ACCEPTED_APP_SLUGS`, enforces `@RequirePermission('fileharbor-*')`
   **fail-closed**, resolves `allowedClientIds`. Scope is never granted by role (`SUPER_ADMIN` included).
   Always filter through `admin/helpers/admin-access.helper.ts` (`resolveAllowedClients`,
   `assertClientAccess`, `buildClientWhere`). Admin controllers are `@SkipThrottle()`.
3. **Self-service (`/me`)** — `BastionSelfServiceGuard`: verified Bastion user, no permission, no scope;
   client resolved from `Client.bastionTenantSlug`. Never reuse it on admin routes.

`@Public()` comes from `@heyatom/bastion-client/nest`. Every `@Cron` runs inside
`PrismaService.runExclusive()` (advisory lock, one replica).

## Creator identity

FileHarbor holds no user accounts. Content is owned by `Creator` = `(clientId, externalId)`, auto-created on
first use; no `X-User-Id` → `externalId: 'system'` (created with every client). On `/me` the externalId is
always the token `sub`, never a header/body value.

## Storage

```
storage/{client.domain || clientId}/images/{imageId}/{original,thumb,blurred}.webp  (+ variants/)
storage/{client.domain || clientId}/avatars/{creatorId}/original.webp
```

Use `StorageService` helpers only (`validatePath`, `sanitizePathComponent`). Storage is always WebP, EXIF
stripped, animated GIF/WebP stay animated. Default placeholders in `defaults/` (repo root, in the image, not
the volume). Every byte figure anywhere = originals' `size` (no thumbs/variants), via `storageUsageByClient`
(`statistics/storage-usage.ts`) — never a second copy of that query.

## Conventions

- **DTOs**: `class-validator` + `@ApiProperty` on every field; responses via
  `plainToInstance(Dto, data, { excludeExtraneousValues: true })` + `@Expose()`.
- **Envelope**: `TransformInterceptor` wraps every 2xx in `{ data }`; lists extend `PageParams` and return
  `paginate(items, total, params)`. Swagger with `@ApiOkData` / `@ApiPaginatedResponse`, never raw
  `@ApiResponse({ type })`. File/stream routes are `@NoTransform()`.
- **Errors**: Nest exceptions; domain code as `{ code, message }`. `GET /images/:id` 403/404 serve a
  placeholder (`X-FileHarbor-Fallback`), never a 4xx body.
- **Audit**: console writes get `@Audit('fh_<noun>.<verb>')`; client-surface deletes/visibility PATCHes use
  `auditClientWrite()` **in the controller, never the service** (services are shared with admin routes).
  Metadata carries ids and field names, never values.
- **Prisma**: `PrismaService` only, `select` to avoid over-fetching, `pnpm exec prisma generate` after schema
  changes. All queries scoped by `clientId`.
- **Config**: `ConfigService` only (`config.get('THUMBNAIL_SIZE')`, nested `config.get('throttle.ttl')`),
  Joi-validated in `src/configs/`. Never `process.env` in services.
- **Logging**: NestJS `Logger`; never `console.log`, tokens, API keys, `Authorization`/`Cookie` headers.
  Share tokens never reach logs (`sanitizeLoggedUrl`).
- **Webhooks**: none — removed in favour of audit (plan 10).
- **Rate limiting**: `@nestjs/throttler` (`THROTTLE_TTL`/`THROTTLE_LIMIT`), IP-keyed for keyless requests only.
- Files `kebab-case`, classes `PascalCase`, constants `UPPER_SNAKE_CASE`; `dto/`, `decorators/`,
  `interceptors/` subdirs.

## New feature module

1. `controller` → `service` → `dto/`
2. `@UseInterceptors(ClientInterceptor)` at class level (or `BastionUserGuard` + `@RequirePermission` +
   `@SkipThrottle()` for admin)
3. `@ClientId()` / `@CreatorExternalId()`; `where: { clientId }` on every query
4. Response via `plainToInstance(..., { excludeExtraneousValues: true })`

## Gotchas

- **Prod URLs**: nginx strips `/v2`, so `API_PREFIX` stays empty and `BASE_URL=https://fileharbor.heyatom.dev/v2`.
  Setting `API_PREFIX=v2` in prod → 404 on everything.
- `CORS_ORIGIN` and `TRUST_PROXY_HOPS=1` required in production; boot fails without `CORS_ORIGIN`.
- `IMAGE_X_ACCEL_REDIRECT` stays **off** in prod (nginx cache > X-Accel); `VIDEO_X_ACCEL_REDIRECT=true`.
- Public image GETs are `immutable`: after a regenerate the console reloads with `?t=<updatedAt>`.
- `Client.ownerPrincipalId` XOR `Client.bastionTenantSlug` (DB CHECK). Personal clients are invisible to
  every console user but their owner.
- `AdminPrincipal`/`AdminIdentity` have **no API**: rows by SQL only, recovery of a lost `fullAccess` is SQL-only.
- `POST /admin/clients` is the only response that ever returns the plaintext `apiKey`.
- `fileharbor_permission_denided.webp`: typo in filename is intentional.
- Metric/alert changes → update `monitoring/alerts.yml` too. Never publish `9091`.

## Env (Bastion)

```
BASTION_URL=http://localhost:3001
BASTION_APP_SLUG=fileharbor
ADMIN_ACCEPTED_APP_SLUGS=fileharbor,meridian  # empty → BASTION_APP_SLUG only
BASTION_CLIENT_API_KEY=<key-from-bastion>     # outgoing audit only; empty → audit disabled
BASTION_TENANT_SLUG=
BASTION_JWKS_TTL_MS=300000
```

## Commands

```bash
pnpm install
pnpm run start:dev            # :3000
pnpm run build && pnpm run start:prod
pnpm run test | test:watch | test:cov
pnpm run prisma:migrate | prisma:generate | prisma:studio
pnpm run lint | format
cp .env.example .env
```

One-off scripts in `src/scripts/` (ship in `dist/`, dry-run by default, `--apply`): `backfill-media-size`,
`backfill-image-dhash`, `regenerate-thumbnails`, `backfill-video-thumbnails`.

## graphify

`graphify-out/` holds the code graph. Start with `graphify query "<question>"`; `graphify path A B`,
`graphify explain X`; after code changes `graphify update .`. `GRAPH_REPORT.md` only for architecture review.

Bastion JWT/JWKS internals: [../docs/integrations/bastion.md](../docs/integrations/bastion.md) (read on demand, not imported).
