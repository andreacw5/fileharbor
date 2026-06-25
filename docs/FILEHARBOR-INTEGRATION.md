# FileHarbor Integration Guide

Guide for Claude to implement `src/modules/fileharbor` in a NestJS app that integrates with the FileHarbor image/avatar API.

---

## Overview

FileHarbor is a multi-tenant image management API. The integrating app creates a dedicated module (`src/modules/fileharbor`) that wraps all HTTP calls. Other app modules inject `FileharborService` and call its methods — they never call FileHarbor directly.

**Base URL:** configured via env var (e.g. `FILEHARBOR_URL=https://fileharbor.example.com`)  
**API prefix:** `v2` (e.g. `POST /v2/images`)  
**Swagger docs:** `{FILEHARBOR_URL}/docs`

---

## Auth Headers

Every request (except public endpoints) requires:

| Header | Value | Notes |
|--------|-------|-------|
| `X-API-Key` | `{FILEHARBOR_API_KEY}` | Required on all non-public endpoints |
| `X-User-Id` | `{externalUserId}` | Optional — attributes image to user; omit for system-level ops |

`X-Client-Id` is **not accepted**. Only `X-API-Key` auth works.

Public endpoints (no auth needed):
- `GET /v2/images/:imageId` (non-private images, or with `?token=`)
- `GET /v2/avatars/:externalUserId`

---

## Module Structure

```
src/modules/fileharbor/
  fileharbor.module.ts
  fileharbor.service.ts
  fileharbor-image.service.ts
  fileharbor-avatar.service.ts
  dto/
    image.dto.ts
    avatar.dto.ts
```

`FileharborModule` is global or imported where needed. `FileharborService` (or split image/avatar services) is what other modules inject.

---

## Environment Variables

```
FILEHARBOR_URL=https://fileharbor.example.com
FILEHARBOR_API_KEY=your-api-key
```

Access via `ConfigService` using `config.get('FILEHARBOR_URL')` etc.

---

## TypeScript Types

Define these in `dto/image.dto.ts` and `dto/avatar.dto.ts`.

### ImageResponse

```typescript
export interface ImageResponse {
  id: string;
  user: object;
  client: object;
  originalName: string;
  format: 'webp' | 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
  size: number;
  mimeType: string;
  isOptimized: boolean;
  isPrivate: boolean;
  tags: string[];
  views: number;
  downloads: number;
  description?: string;
  createdAt: string; // ISO date
  url: string;           // relative: /v2/images/{id}
  thumbnailUrl?: string; // relative: /v2/images/{id}?thumb=true
  fullPath: string;      // absolute: {baseUrl}/v2/images/{id}
}
```

### ListImagesResponse

```typescript
export interface ListImagesResponse {
  data: ImageResponse[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}
```

### ShareLinkResponse

```typescript
export interface ShareLinkResponse {
  id: string;
  imageId: string;
  readToken: string;
  createdAt: string;
  expiresAt?: string;
  shareUrl: string; // relative URL with token
}
```

### AvatarResponse

```typescript
export interface AvatarResponse {
  id: string;
  userId: string;
  format: 'webp' | 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
  size: number;
  mimeType: string;
  isOptimized: boolean;
  createdAt: string;
  url: string;           // relative: /v2/avatars/{externalUserId}
  thumbnailUrl?: string; // relative: /v2/avatars/{externalUserId}?thumb=true
  fullPath: string;      // absolute: {baseUrl}/v2/avatars/{externalUserId}
}
```

### DeleteResponse

```typescript
export interface DeleteResponse {
  success: boolean;
  message: string;
}
```

---

## Image Endpoints

### POST /v2/images — Upload image

**Auth:** `X-API-Key` required. `X-User-Id` optional.  
**Content-Type:** `multipart/form-data`

Form fields:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | binary | Yes | JPEG, PNG, WebP, GIF |
| `albumId` | string (UUID) | No | Associate with album |
| `tags` | string[] | No | Array of tag strings |
| `description` | string | No | |
| `isPrivate` | boolean | No | Default: `false` |
| `username` | string | No | Saved/updated on user record |

Returns: `ImageResponse` (201)

```typescript
async uploadImage(
  file: Buffer,
  filename: string,
  mimetype: string,
  userId?: string,
  options?: { albumId?: string; tags?: string[]; description?: string; isPrivate?: boolean; username?: string }
): Promise<ImageResponse> {
  const form = new FormData();
  form.append('file', file, { filename, contentType: mimetype });
  if (options?.albumId) form.append('albumId', options.albumId);
  if (options?.tags) options.tags.forEach(t => form.append('tags', t));
  if (options?.description) form.append('description', options.description);
  if (options?.isPrivate != null) form.append('isPrivate', String(options.isPrivate));
  if (options?.username) form.append('username', options.username);

  return this.post('/images', form, userId);
}
```

---

### GET /v2/images — List images (paginated)

**Auth:** `X-API-Key` required.

Query params:
| Param | Type | Notes |
|-------|------|-------|
| `userId` | string | Filter by uploader |
| `albumId` | string | Filter by album |
| `page` | number | Default: 1 |
| `perPage` | number | Default: 20, max: 100 |

Returns: `ListImagesResponse` (200)

---

### GET /v2/images/:imageId — Get image

**Auth:** Public for non-private. `X-API-Key` needed for private images (without token).  
**Returns:** Image binary (WebP by default) or JSON metadata if `?info=true`.

Query params:
| Param | Type | Notes |
|-------|------|-------|
| `info` | boolean | Return JSON metadata instead of binary |
| `thumb` | boolean | Return pre-generated thumbnail |
| `download` | boolean | Force download (Content-Disposition header) |
| `width` | number | Resize width (ignored if thumb=true) |
| `height` | number | Resize height (ignored if thumb=true) |
| `format` | `webp\|jpeg\|png` | Output format, default: webp |
| `quality` | number 1–100 | Default: 85 |
| `token` | string | Share token for private access |
| `t` | string | Cache-buster timestamp (ignored by server) |

**Important:** On 404 or 403, the server returns a fallback WebP image (not an error), with `X-FileHarbor-Fallback: not_found` or `permission_denied` header. Check this header when parsing binary responses. Use `?info=true` to get proper 404/403 errors.

To get metadata as JSON: `GET /v2/images/:imageId?info=true` → returns `ImageResponse`

---

### PATCH /v2/images/:imageId — Update metadata

**Auth:** `X-API-Key` required. `X-User-Id` required (must be owner).

Body (JSON):
```typescript
{ tags?: string[]; description?: string }
```

Returns: `ImageResponse` (200)

---

### DELETE /v2/images/:imageId — Delete image

**Auth:** `X-API-Key` required.

Returns: `DeleteResponse` (200)

---

### POST /v2/images/:imageId/share — Create share link

**Auth:** `X-API-Key` required. `X-User-Id` required (must be owner).

Body (JSON):
```typescript
{ expiresAt?: string } // ISO date string, optional
```

Returns: `ShareLinkResponse` (201)  
Use `readToken` from response to access image: `GET /v2/images/:imageId?token={readToken}`

---

### DELETE /v2/images/share/:shareId — Revoke share link

**Auth:** `X-API-Key` required. `X-User-Id` required (must be owner).

Returns: `DeleteResponse` (200)

---

## Avatar Endpoints

One avatar per user. Upload overwrites existing avatar automatically.

### POST /v2/avatars — Upload/update avatar

**Auth:** `X-API-Key` required.  
**Content-Type:** `multipart/form-data`

Form fields:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | binary | Yes | JPEG, PNG, WebP, GIF |
| `externalUserId` | string | Yes | Must be in form body (not header) |

Returns: `AvatarResponse` (201)

```typescript
async uploadAvatar(
  file: Buffer,
  filename: string,
  mimetype: string,
  externalUserId: string,
): Promise<AvatarResponse> {
  const form = new FormData();
  form.append('file', file, { filename, contentType: mimetype });
  form.append('externalUserId', externalUserId);
  // Note: externalUserId goes in form body, NOT in X-User-Id header
  return this.post('/avatars', form);
}
```

---

### GET /v2/avatars/:externalUserId — Get avatar

**Auth:** Public endpoint (no API key needed).

Query params:
| Param | Type | Notes |
|-------|------|-------|
| `info` | boolean | Return JSON metadata (`AvatarResponse`) |
| `thumb` | boolean | Return thumbnail |
| `download` | boolean | Force download |
| `t` | string | Cache-buster timestamp |

Returns: Binary WebP image or JSON if `?info=true`

---

### DELETE /v2/avatars/:externalUserId — Delete avatar

**Auth:** `X-API-Key` required.

Returns: `DeleteAvatarResponse` (200)

---

## Service Implementation Pattern

```typescript
@Injectable()
export class FileharborService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = `${config.get('FILEHARBOR_URL')}/v2`;
    this.apiKey = config.get('FILEHARBOR_API_KEY');
  }

  private headers(userId?: string): Record<string, string> {
    const h: Record<string, string> = { 'X-API-Key': this.apiKey };
    if (userId) h['X-User-Id'] = userId;
    return h;
  }

  // Use axios, got, or native fetch — pass multipart for uploads
}
```

**Use `axios` with `form-data` package for multipart uploads** (NestJS standard). Inject `HttpModule` from `@nestjs/axios`.

---

## Key Behaviors to Know

1. **Images always stored as WebP.** Input JPEG/PNG/GIF auto-converted.
2. **Thumbnails auto-generated** on upload. Access via `?thumb=true`.
3. **EXIF metadata stripped** on upload.
4. **Private images** (`isPrivate: true`) return 403 without valid API key or share token.
5. **Binary 404/403 fallback:** `GET /v2/images/:id` (without `?info`) never returns 404/403 — instead returns a placeholder WebP. Detect via `X-FileHarbor-Fallback` response header.
6. **Avatar `externalUserId` is in form body**, not the `X-User-Id` header — different from image upload.
7. **Share tokens (`readToken`)** allow access to private images without API key: `?token={readToken}`.
8. **Cache headers:** images have `max-age=31536000, immutable`; avatars have `max-age=86400`. Use `?t={timestamp}` to bust cache after updates.
9. **User auto-created:** FileHarbor creates internal user records on first use. No pre-registration needed.
10. **Rate limiting** is enabled on the server. Don't hammer endpoints in loops — batch or debounce as needed.
