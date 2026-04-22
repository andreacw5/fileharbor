# Architecture

## Overview

FileHarbor follows a **multi-tenant** architecture where every piece of data is scoped to a `clientId`. Each tenant (client) authenticates using a unique API key and can manage its own images, avatars, and albums independently.

```
┌─────────────────────────────────────────────────────────────────┐
│                          FileHarbor API                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Image   │  │  Avatar  │  │  Album   │  │  Admin Portal │  │
│  │  Module  │  │  Module  │  │  Module  │  │    Module     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │             │                │           │
│  ┌────▼──────────────▼─────────────▼────┐  ┌───────▼────────┐  │
│  │         Client / Auth Module          │  │  Admin JWT     │  │
│  │   ClientInterceptor  |  API Key Auth  │  │  Guard & Auth  │  │
│  └────────────────────┬──────────────────┘  └────────────────┘  │
│                       │                                         │
│  ┌────────────────────▼──────────────────┐                      │
│  │         Prisma Module (PostgreSQL)    │                      │
│  └────────────────────┬──────────────────┘                      │
│                       │                                         │
│  ┌────────────────────▼──────────────────┐                      │
│  │           Storage Module (Sharp)      │                      │
│  └───────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Map

| Module | Path | Responsibility |
|--------|------|----------------|
| `client` | `src/modules/client/` | Tenant resolution, API key auth, user management, `ClientInterceptor` |
| `image` | `src/modules/image/` | Upload, retrieval, metadata, transformations, share links |
| `avatar` | `src/modules/avatar/` | Single-avatar-per-user lifecycle |
| `album` | `src/modules/album/` | Collections, public/private access, token sharing |
| `storage` | `src/modules/storage/` | All disk I/O and Sharp image processing |
| `webhook` | `src/modules/webhook/` | Fire-and-forget Discord webhook notifications |
| `job` | `src/modules/job/` | Scheduled cleanup cron jobs |
| `admin` | `src/modules/admin/` | Admin portal: JWT auth, multi-role management, cross-client ops |
| `prisma` | `src/modules/prisma/` | Database service wrapper |
| `app` | `src/modules/app/` | Global status controller, app bootstrap |

---

## Multi-Tenancy

Every request goes through `ClientInterceptor` which:
1. Reads `X-API-Key` header → resolves the `Client` record → attaches `request.clientId` and `request.client`
2. Reads `X-User-Id` header (or falls back to `request.body.externalUserId`) → attaches `request.externalUserId`

FileHarbor **never stores real user accounts** from clients. Instead it auto-creates internal `User` records on first use, identified by `externalUserId`. When no user ID is provided, the image is attributed to a reserved `system` user auto-created with every new client.

All Prisma queries are always scoped:
```typescript
await this.prisma.image.findMany({
  where: { clientId, userId },
});
```

---

## Data Model

```
Client (tenant)
  │
  ├─── User (externalUserId from client system)
  │      ├─── Image (multiple)
  │      ├─── Avatar (one per user)
  │      └─── Album (multiple)
  │             ├─── AlbumImage (join table)
  │             └─── AlbumToken (time-limited access tokens)
  │
  └─── ImageShareLink (per image, time-limited)
```

Admin domain (separate):
```
AdminUser
  ├─── AdminClientAccess (allowed clients when allClientsAccess = false)
  └─── AdminRefreshToken (session management)
```

---

## Request Flow

```
HTTP Request
    │
    ▼
ClientInterceptor
  ├── Validate X-API-Key  ──► 401 if missing/invalid
  └── Resolve externalUserId
    │
    ▼
Controller (e.g. ImageController)
    │
    ▼
Service (e.g. ImageService)
  ├── Prisma queries (scoped by clientId)
  ├── StorageService (file I/O + Sharp)
  └── WebhookService (fire & forget)
    │
    ▼
Response DTO (plainToInstance with @Expose())
```

