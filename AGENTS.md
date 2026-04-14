# FileHarbor 2.0 – Agent Guide

## Architecture Overview

Multi-tenant NestJS 10 image management API. All data is scoped by `clientId`; requests are authenticated via `X-API-Key` header (validated by `ClientInterceptor`). Users are referenced by an external ID (`X-User-Id`) from the client's own system—FileHarbor auto-creates internal `User` records on first use.

**Module map** (`src/modules/`):
| Module | Role |
|--------|------|
| `client` | Auth, tenant resolution, user management |
| `image` | Upload, retrieval, transformations, share links |
| `avatar` | Single-avatar-per-user lifecycle |
| `album` | Collections, token-based private access |
| `storage` | All disk I/O and Sharp image processing |
| `webhook` | Fire-and-forget Discord webhook notifications |
| `job` | Scheduled cleanup (cron jobs — see note below) |
| `prisma` | Database service wrapper |

## Auth & Request Context

Every non-`@Public()` controller goes through `ClientInterceptor` (`src/modules/client/interceptors/client.interceptor.ts`), which:
1. Reads `X-API-Key` → resolves `client` → attaches `request.clientId` and `request.client`
2. Reads `X-User-Id` (or falls back to `request.query.externalUserId` / `request.body.externalUserId`) → attaches `request.externalUserId`

Extract these in controllers with param decorators:
```typescript
import { ClientId, UserId } from '@/modules/client/decorators/client.decorator';
// UserId is an alias for ExternalUserId
```

Mark endpoints that don't require auth with `@Public()` from `src/modules/client/decorators/public.decorator.ts`. On public endpoints the interceptor still populates `clientId` if a valid key is supplied (used for private-image access checks).

## User Identity Pattern

FileHarbor never receives "real" user accounts. Services call `prisma.user.findUnique({ where: { clientId_externalUserId: { clientId, externalUserId } } })` and create on first use. When no `X-User-Id` is provided, images are attributed to a reserved `externalUserId: 'system'` user that is auto-created alongside every new client (`createClient()` in `client.service.ts`).

## Storage Paths

All file paths are built via `StorageService` helpers — never construct paths manually:
```
storage/{client.domain || clientId}/images/{imageId}/original.webp
storage/{client.domain || clientId}/images/{imageId}/thumb.webp
storage/{client.domain || clientId}/avatars/{userId}/original.webp
```
`StorageService.validatePath()` blocks directory traversal; `sanitizePathComponent()` strips `..`, `/`, `\`, and null bytes while allowing dots in domain names.

Default fallback images live at `storage/defaults.fileharbor/`. `GET /images/:id` returns `fileharbor_not_found.webp` or `fileharbor_permission_denided.webp` (note the typo in the filename) instead of 4xx errors for non-`info` requests.

## DTO / Response Pattern

All service responses are shaped with `plainToInstance(..., { excludeExtraneousValues: true })` — only properties decorated with `@Expose()` are returned. Follow this pattern for every new response DTO.

## Webhook System

`WebhookService.sendWebhook()` posts Discord embeds for events in the `WebhookEvent` enum. It is always called non-blocking:
```typescript
this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_UPLOADED, payload)
  .catch(error => this.logger.warn(...));
```
Webhooks are opt-in per client (`client.webhookEnabled` + `client.webhookUrl`). Failures are swallowed — do not let them propagate.

## Scheduled Jobs

Cron decorators are **currently commented out** across `image.cleanup.job.ts`, `avatar.cleanup.job.ts`, `album.cleanup.job.ts`, and `job.service.ts`. Re-enable with `@Cron(CronExpression.EVERY_HOUR)`. The `JobModule` does not re-import `ImageModule`/`AvatarModule` — inject `StorageService` and `PrismaService` directly.

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
```

Swagger UI: `http://localhost:3000/docs` — Prometheus metrics: `http://localhost:3000/metrics`.

## Config Access

`ConfigModule` is global with Joi validation (`src/configs/config.validation.ts`). Access via `ConfigService`:
```typescript
this.config.get('THUMBNAIL_SIZE')       // raw env key
this.config.get('throttle.ttl')         // nested key from config.schema.ts
```

## Adding a New Feature Module

1. Follow existing module structure: `controller` → `service` → `dto/` subdir
2. Apply `@UseInterceptors(ClientInterceptor)` at controller class level
3. Use `@ClientId()` / `@UserId()` decorators for tenant/user context
4. Scope all Prisma queries with `where: { clientId }` 
5. Return responses via `plainToInstance(ResponseDto, data, { excludeExtraneousValues: true })`
6. Fire webhooks non-blocking with `.catch()`
7. Import `WebhookModule` if needed (it is already exported from `WebhookModule`)

