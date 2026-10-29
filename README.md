<p align="center">
  <a href="https://github.com/andreacw5/fileharbor" target="blank"><img src="app_logo.png" width="500" alt="FileHarbor logo" /></a>
</p>

<p align="center">
Multi-tenant media service for images, videos, avatars and albums.<br/>
NestJS 11 · Prisma 7 · PostgreSQL · Sharp
</p>

<p align="center">
  <a href="https://github.com/andreacw5/fileharbor/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/andreacw5/fileharbor"></a>
</p>

FileHarbor is the media CDN of the HeyAtom platform. Apps upload through an API key, FileHarbor stores
everything as WebP on local disk, serves it with resizing and caching, and keeps it optimized in the
background. Admins manage it through Meridian, signed in with Bastion.

## Features

- **Multi-tenant**: every row is scoped by client, resolved from the `X-API-Key` header.
- **Images**: WebP conversion, thumbnails, on-demand resize snapped to fixed sizes, ready-made `srcset`,
  private images, share links, blurred previews (`?blur=1`), animated GIF/WebP kept animated.
- **Videos**: MP4 upload, ffmpeg thumbnail and metadata, range streaming (optionally via nginx `X-Accel-Redirect`).
- **Avatars**: one per creator, plus self-service `/me/avatar` for Bastion end users.
- **Albums**: public or private, temporary access tokens, addressable by external id.
- **Background jobs**: hourly re-optimization, opt-in Tinify compression per client, orphan file cleanup,
  daily storage snapshots.
- **Admin API**: cross-client console behind Bastion JWT with per-route permissions and per-client scope,
  duplicate detection (dHash), storage reports, audit events to Bastion.
- **Ops**: Prometheus metrics on a separate port, `/health/live` and `/health/ready`, request ids, Swagger.

## Quick start

Requires Node ≥ 22.12, pnpm and PostgreSQL. pnpm is enforced: `npm` and `yarn` refuse to install.

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL at least
pnpm run prisma:generate
pnpm run prisma:migrate       # apply migrations
pnpm run start:dev            # http://localhost:3000
```

- Swagger UI: `http://localhost:3000/docs` (on by default in `development`/`test`, `ENABLE_SWAGGER` otherwise)
- Metrics: `http://localhost:9091/metrics`

Every environment variable, with its default and purpose, is documented in [`.env.example`](.env.example)
and validated at boot by `src/configs/config.validation.ts`.

## Authentication

| Surface | Routes | Auth |
|---|---|---|
| Client API | `images`, `videos`, `avatars`, `albums`, `creators`, `client` | `X-API-Key` (+ `X-User-Id` for the acting creator) |
| Admin API | `admin/*` | Bastion user JWT (`Authorization: Bearer`), `fileharbor-*` permissions |
| Self-service | `me/avatar` | Bastion user JWT, tenant mapped to a client |
| Public | `GET /images/:id`, shared albums, `health/*` | none (access rules per resource) |

FileHarbor has no user accounts. Callers pass their own user id in `X-User-Id`; FileHarbor creates a
matching `Creator` on first use. Uploads without it belong to the client's `system` creator.

```http
POST /images
X-API-Key: <client-api-key>
X-User-Id: <your-user-id>
Content-Type: multipart/form-data
```

Integration guide for other services: [`../docs/integrations/fileharbor.md`](../docs/integrations/fileharbor.md).
The consumer SDK is `@heyatom/client`.

## Storage layout

```
storage/{client.domain || clientId}/
  images/{imageId}/original.webp, thumb.webp, blurred.webp, variants/
  avatars/{creatorId}/original.webp
  videos/{videoId}/...
```

Paths are built only through `StorageService`, which sanitizes components and blocks traversal.

## Development

```bash
pnpm run start:dev        # watch mode
pnpm run test             # Jest unit tests
pnpm run lint             # eslint --fix
pnpm run format           # prettier
pnpm run prisma:studio    # DB GUI
pnpm run openapi:dump     # refresh openapi.json
```

One-off maintenance scripts live in `src/scripts/` and ship in `dist/` (dry run unless `--apply`):
`backfill-media-size`, `backfill-image-dhash`, `regenerate-thumbnails`.

## Deployment

Docker images are built by CI only (amd64), from the [`Dockerfile`](Dockerfile). In production:

- `NODE_ENV=production`, `CORS_ORIGIN` set (boot fails without it), `TRUST_PROXY_HOPS=1` behind nginx.
- nginx serves `https://fileharbor.heyatom.dev/v2/...` and strips `/v2`: keep `API_PREFIX` empty and put
  the public prefix in `BASE_URL`.
- Never expose `METRICS_PORT`; Prometheus scrapes it on the internal network. Alert rules are in
  [`monitoring/alerts.yml`](monitoring/alerts.yml).

## Docs

- [`CLAUDE.md`](CLAUDE.md): architecture, auth, jobs, metrics and conventions in detail
- [`docs/plans/`](docs/plans/README.md): feature plans and their status
- [`docs/BACKLOG.md`](docs/BACKLOG.md): open work
- [`docs/external-album-api.md`](docs/external-album-api.md): album API for clients
- [`CHANGELOG.md`](CHANGELOG.md)

## License

[MIT](LICENSE.md)
