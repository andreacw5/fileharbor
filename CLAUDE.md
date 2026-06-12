# FileHarbor – Claude Code Guide

## Tech Stack

- **Framework:** NestJS 10 (TypeScript, ES2021, CommonJS)
- **Database:** PostgreSQL + Prisma ORM (client at `generated/prisma/`)
- **Image Processing:** Sharp
- **Auth:** JWT (admin), API Keys (client)
- **Package Manager:** pnpm (enforced — never use npm or yarn)
- **Testing:** Jest
- **API Docs:** Swagger/OpenAPI at `/docs`
- **Path alias:** `@/*` → `src/*`

## Architecture

Multi-tenant NestJS 10 image management API. All data scoped by `clientId`. Auth via `X-API-Key` header validated by `ClientInterceptor`. Users referenced by external ID (`X-User-Id`) — FileHarbor auto-creates internal `User` records on first use.

**Modules** (`src/modules/`):
| Module | Role |
|--------|------|
| `client` | Auth, tenant resolution, user management |
| `image` | Upload, retrieval, transformations, share links |
| `avatar` | Single-avatar-per-user lifecycle |
| `album` | Collections, token-based private access |
| `storage` | All disk I/O and Sharp image processing |
| `webhook` | Fire-and-forget Discord webhook notifications |
| `job` | Scheduled cleanup (cron jobs — currently commented out) |
| `admin` | Admin portal: JWT auth, multi-role user management, cross-client ops |
| `prisma` | Database service wrapper |

## Auth & Request Context

**Security Note:** `X-Client-Id` header no longer accepted. Only `X-API-Key` auth supported.

Every non-`@Public()` controller goes through `ClientInterceptor` (`src/modules/client/interceptors/client.interceptor.ts`):
1. Reads `X-API-Key` → resolves `client` → attaches `request.clientId` and `request.client`
2. Reads `X-User-Id` (or falls back to `request.query.externalUserId` / `request.body.externalUserId`) → attaches `request.externalUserId`

```typescript
import { ClientId, UserId } from '@/modules/client/decorators/client.decorator';
// UserId is an alias for ExternalUserId
```

Mark public endpoints with `@Public()` from `src/modules/client/decorators/public.decorator.ts`. On public endpoints the interceptor still populates `clientId` if a valid key is supplied.

## User Identity Pattern

FileHarbor never receives real user accounts. Services call:
```typescript
prisma.user.findUnique({ where: { clientId_externalUserId: { clientId, externalUserId } } })
```
Create on first use. When no `X-User-Id` is provided, images are attributed to `externalUserId: 'system'` (auto-created alongside every new client in `createClient()` in `client.service.ts`).

## Storage Paths

Never construct paths manually — use `StorageService` helpers:
```
storage/{client.domain || clientId}/images/{imageId}/original.webp
storage/{client.domain || clientId}/images/{imageId}/thumb.webp
storage/{client.domain || clientId}/avatars/{userId}/original.webp
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

Cron decorators are **currently commented out** in `image.cleanup.job.ts`, `avatar.cleanup.job.ts`, `album.cleanup.job.ts`, and `job.service.ts`. Re-enable with `@Cron(CronExpression.EVERY_HOUR)`. `JobModule` does not re-import `ImageModule`/`AvatarModule` — inject `StorageService` and `PrismaService` directly.

## Admin Module

Separate auth domain — does **not** use `ClientInterceptor` or `X-API-Key`. Uses JWT-based `Bearer` token flow:

- **`AdminJwtGuard`** (`guards/admin-jwt.guard.ts`) — validates `Authorization: Bearer <token>`, attaches `request.adminUser` (`AdminJwtPayload`)
- **`@AdminUser()`** decorator (`decorators/admin-user.decorator.ts`) — extracts `AdminJwtPayload`
- **`AdminInitService`** — creates first `SUPER_ADMIN` from `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` on startup if no admins exist

Roles: `SUPER_ADMIN` / `ADMIN`. `allClientsAccess` flag controls scope; when `false`, access limited to `allowedClientIds` in JWT payload.

Auth flow: `POST /admin/auth/login` → `POST /admin/auth/refresh` → `POST /admin/auth/logout`.

Required env vars:
```
ADMIN_DEFAULT_EMAIL=
ADMIN_DEFAULT_PASSWORD=
ADMIN_DEFAULT_NAME=           # optional, defaults to "Super Admin"
JWT_ADMIN_SECRET=
JWT_ADMIN_EXPIRES_IN=         # e.g. 15m
JWT_ADMIN_REFRESH_SECRET=
JWT_ADMIN_REFRESH_EXPIRES_IN= # e.g. 7d
```

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

## API Versioning

Prefix set via `API_PREFIX` env var (default: `v2`). Example: `POST /v2/images/upload`.

## Image Processing

Sharp handles all transformations. Inputs: JPEG, PNG, WebP, GIF. Storage always WebP. Operations:
- Auto WebP conversion + thumbnail generation on upload
- On-demand resize via query params
- EXIF removal
- Quality set from env vars

## DB Entities

`Client` → `User` (by `externalUserId`) → `Image`, `Avatar`
`Album` → `AlbumImage` (many-to-many with `Image`) → `AlbumToken` (temp access for private albums)

Always add indexes on frequently queried fields.

## Error Handling

```typescript
throw new NotFoundException('Image not found');
throw new ForbiddenException('Access denied');
throw new BadRequestException('Invalid file format');
```

## Config Access

`ConfigModule` is global with Joi validation (`src/configs/config.validation.ts`):
```typescript
this.config.get('THUMBNAIL_SIZE')    // raw env key
this.config.get('throttle.ttl')      // nested key from config.schema.ts
```

## Adding a New Feature Module

1. Follow existing structure: `controller` → `service` → `dto/` subdir
2. Apply `@UseInterceptors(ClientInterceptor)` at controller class level
3. Use `@ClientId()` / `@UserId()` for tenant/user context
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
pnpm run test:e2e         # jest --config ./test/jest-e2e.json
pnpm run prisma:migrate   # generate + apply migration
pnpm run prisma:generate  # regenerate Prisma client to generated/prisma/
pnpm run prisma:studio    # DB GUI
pnpm run lint             # eslint --fix
pnpm run format           # prettier
pnpm run test:watch       # jest watch
pnpm run test:cov         # jest coverage
pnpm run prisma:seed      # seed DB (optional)
cp .env.example .env      # first-time setup
```

Swagger UI: `http://localhost:3000/docs` — Prometheus metrics: `http://localhost:3000/metrics`

## graphify

Knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain don't surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
