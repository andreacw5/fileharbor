# Video Module — Implementation Plan

## Context

Multi-tenant MP4 storage with full feature parity to ImageModule:
internal user association, tags (reuse `Tag` model), admin bookmarks,
video delivery via Nginx X-Accel-Redirect, ffmpeg thumbnail, webhook events, cleanup job.

Schema already complete and validated. Migration pending (manual).

---

## Phase 1 — Schema

✅ Done. All fields, relations, and indexes present. Run migration manually.

---

## Phase 2 — Storage Layer

**File:** `src/modules/storage/storage.service.ts`

Add methods (mirror of image equivalents):

```typescript
getVideoPath(domain: string, videoId: string): string
getVideoFilePath(domain: string, videoId: string, variant: 'original' | 'thumb'): string
  // original → original.mp4
  // thumb    → thumb.webp
getClientVideoIds(domain: string): Promise<string[]>
```

---

## Phase 3 — ffmpeg Thumbnail

**Dependencies:**
```bash
pnpm add fluent-ffmpeg ffmpeg-static
pnpm add -D @types/fluent-ffmpeg @types/ffmpeg-static
```

`ffmpeg-static` include il binario ffmpeg — nessuna dipendenza di sistema, nessuna modifica al Dockerfile.
Il binario (~70MB) viene bundlato nell'immagine Docker insieme al progetto.

**File:** `src/modules/storage/storage.service.ts`

```typescript
async extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  quality: number = 80,
): Promise<void>
```

Strategy: ffmpeg extracts frame at 0s as JPEG → Sharp converts to WebP.

```typescript
import * as ffmpegStatic from 'ffmpeg-static';
import * as ffmpeg from 'fluent-ffmpeg';
import * as sharp from 'sharp';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Point fluent-ffmpeg to the bundled binary
ffmpeg.setFfmpegPath(ffmpegStatic);

async extractVideoThumbnail(videoPath, outputPath, quality = 80) {
  const tmpFile = path.join(os.tmpdir(), `${uuidv4()}.jpg`);

  // Timeout: corrupted/malicious files can hang ffmpeg indefinitely
  const FFMPEG_TIMEOUT_MS = 30_000;

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        // size: '640x?' = max 640px wide, preserve aspect ratio
        .screenshots({ timestamps: ['00:00:00'], filename: path.basename(tmpFile), folder: path.dirname(tmpFile), size: '640x?' })
        .on('end', resolve)
        .on('error', reject);
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ffmpeg thumbnail extraction timed out')), FFMPEG_TIMEOUT_MS)
    ),
  ]).catch(async (err) => {
    await fs.unlink(tmpFile).catch(() => {});
    throw new InternalServerErrorException(`Failed to extract thumbnail: ${err.message}`);
  });

  const jpegBuffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => {});

  const webpBuffer = await sharp(jpegBuffer).webp({ quality }).toBuffer();
  await this.saveFile(outputPath, webpBuffer);
}
```

**Check ffmpeg availability on startup** in `StorageService.onModuleInit()`:

```typescript
async onModuleInit() {
  await new Promise<void>((resolve, reject) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) reject(new Error('ffmpeg binary not found — install ffmpeg on the server'));
      else resolve();
    });
  });
}
```

Called during upload after raw MP4 saved to disk.

---

## Phase 4 — Tag Utils Extension

**File:** `src/modules/tag/tag.utils.ts`

Add `buildVideoTagCreateInput()` mirroring `buildImageTagCreateInput()`:

```typescript
export function buildVideoTagCreateInput(
  tags: string[],
  clientId: string,
): Prisma.VideoTagCreateManyVideoInput[]
```

`extractTagNames()` and `normalizeTagNames()` already generic — reuse as-is.

---

## Phase 5 — VideoModule Core

**New directory:** `src/modules/video/`

### 5a. DTOs

`src/modules/video/dto/`

| File | Content |
|------|---------|
| `upload-video.dto.ts` | `tags?`, `description?`, `isPrivate?` |
| `video-response.dto.ts` | `VideoResponseDto` with `@Expose()` |
| `list-videos-response.dto.ts` | paginated list + `PaginationMetaDto` |
| `get-video.dto.ts` | query params: `download?` |
| `delete-video-response.dto.ts` | `DeleteVideoResponseDto` |
| `index.ts` | barrel export |

### 5b. Service

`src/modules/video/video.service.ts`

Methods:

| Method | Notes |
|--------|-------|
| `uploadVideo()` | validate MP4 mimetype, save raw, extract thumbnail, save DB, fire webhook |
| `getVideoById()` | resolve user/client access, fire-and-forget views increment, return video record |
| `getVideoStreamPath()` | return absolute disk path for X-Accel-Redirect (auth check here) |
| `downloadVideo()` | increment downloads, return path |
| `listVideos()` | paginated, filter by tag/user/private |
| `deleteVideo()` | delete DB + storage dir |
| `updateVideoMetadata()` | description, isPrivate, tags |
| `getVideoMetadata()` | info endpoint, no view increment |
| `formatVideoResponse()` | `plainToInstance(VideoResponseDto, ...)` |

Internal user resolution: `UserService.findOrCreateUser(clientId, externalUserId)`.

Webhook calls (non-blocking `.catch()`):
- `WebhookEvent.VIDEO_UPLOADED`
- `WebhookEvent.VIDEO_DELETED`

### 5c. Controller

`src/modules/video/video.controller.ts`

```
POST   /videos/upload     — upload MP4
GET    /videos/:id        — stream via X-Accel-Redirect (or fallback in dev)
GET    /videos/:id/thumb  — serve thumb.webp (poster for <video> tag)
GET    /videos/:id/info   — metadata only
GET    /videos            — list (paginated)
DELETE /videos/:id        — delete
PATCH  /videos/:id        — update metadata/tags
```

**Thumbnail endpoint** — serve WebP direttamente da NestJS (file piccolo, no X-Accel-Redirect):

```typescript
@Get(':id/thumb')
async getThumb(
  @Param('id') id: string,
  @ClientId() clientId: string,
  @Res() res: Response,
) {
  // getVideoById must enforce isPrivate check — same auth as stream endpoint
  const video = await this.videoService.getVideoById(id, clientId);
  const thumbPath = this.storage.getVideoFilePath(video.domain, id, 'thumb');
  const buffer = await this.storage.readFile(thumbPath);

  // No cache for private videos
  const cacheHeader = video.isPrivate
    ? 'no-store'
    : 'public, max-age=86400';

  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': cacheHeader });
  res.end(buffer);
}
```

⚠️ `getVideoById()` must throw `ForbiddenException` for private videos when caller has no access — thumb must be as protected as the video itself.

**Usage lato GUI:**

```html
<video
  poster="https://api.fileharbor.com/v2/videos/{id}/thumb"
  controls
  preload="none"
>
  <source src="https://api.fileharbor.com/v2/videos/{id}" type="video/mp4">
</video>
```

- `poster` → carica solo WebP thumb, leggero e istantaneo
- `preload="none"` → video non caricato finché user non preme play
- Al play → browser invia `Range: bytes=0-` → Nginx gestisce da disco

**Video delivery — X-Accel-Redirect (prod) + createReadStream fallback (dev):**

```typescript
@Get(':id')
async streamVideo(
  @Param('id') id: string,
  @ClientId() clientId: string,
  @Query('download') download: string,
  @Req() req: Request,   // ← required for Range header in dev fallback
  @Res() res: Response,
) {
  const video = await this.videoService.getVideoStreamPath(id, clientId);

  // Sanitize filename: strip characters that break Content-Disposition header
  const safeName = video.originalName.replace(/["\n\r]/g, '_');
  const disposition = download === 'true'
    ? `attachment; filename="${safeName}"`
    : `inline; filename="${safeName}"`;

  if (process.env.NODE_ENV === 'production') {
    // Re-validate storagePath before injecting into Nginx header
    if (video.storagePath.includes('..') || video.storagePath.startsWith('/')) {
      throw new ForbiddenException('Invalid storage path');
    }
    res.set({
      'X-Accel-Redirect': `/internal-videos/${video.storagePath}/original.mp4`,
      'Content-Type': 'video/mp4',
      'Content-Disposition': disposition,
    });
    res.end();
  } else {
    // Dev fallback: stream from disk with Range support
    const filePath = this.storage.getVideoFilePath(video.domain, id, 'original');
    const stat = await fs.stat(filePath);
    const range = (req as any).headers?.range as string | undefined;

    if (range) {
      const [startStr, endStr] = range.replace(/^bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1_048_576, stat.size - 1);

      // Validate Range values
      if (isNaN(start) || isNaN(end) || start < 0 || end >= stat.size || start > end) {
        res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        return;
      }

      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
        'Content-Disposition': disposition,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.set({
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': disposition,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  }
}
```

**Multer config — MUST use `diskStorage` for video:**

```typescript
// ⚠️ memoryStorage NOT usable for video — 500MB in RAM = OOM/DoS
// Images use memoryStorage (go through Sharp buffer); video goes straight to disk
MulterModule.register({
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `${uuidv4()}.mp4.tmp`),
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new BadRequestException('Only MP4 files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
})
```

After upload: move tmp file to final storage path, then run ffmpeg thumbnail.
Delete tmp file in finally block regardless of outcome.

**MP4 magic bytes validation** — after multer saves to disk, before processing:

```typescript
// MP4 files have 'ftyp' at bytes 4-7
const fd = await fs.open(tmpPath, 'r');
const magic = Buffer.alloc(8);
await fd.read(magic, 0, 8, 0);
await fd.close();
if (magic.slice(4, 8).toString('ascii') !== 'ftyp') {
  await fs.unlink(tmpPath).catch(() => {});
  throw new BadRequestException('File is not a valid MP4');
}
```

### 5d. Module

`src/modules/video/video.module.ts`

Imports: `StorageModule`, `PrismaModule`, `WebhookModule`, `HttpModule`, `UserModule`.

---

## Phase 6 — Webhook Events

**File:** `src/modules/webhook/webhook.service.ts`

Add to `WebhookEvent` enum:

```typescript
VIDEO_UPLOADED = 'video.uploaded',
VIDEO_DELETED  = 'video.deleted',
```

---

## Phase 7 — Bookmarks Extension

**File:** `src/modules/bookmarks/bookmarks.service.ts`

Add methods mirroring image bookmark pattern:

```typescript
bookmarkVideo(adminUserId: string, videoId: string, clientId: string): Promise<...>
removeVideoBookmark(adminUserId: string, videoId: string): Promise<...>
listVideoBookmarks(params: AdminVideoBookmarksListParams): Promise<...>
getBookmarkByAdminAndVideo(adminUserId: string, videoId: string): Promise<...>
```

**File:** `src/modules/admin/controllers/bookmarks-admin.controller.ts`

Add endpoints:

```
POST   /admin/bookmarks/videos/:videoId   — bookmark video
DELETE /admin/bookmarks/videos/:videoId   — remove bookmark
GET    /admin/bookmarks/videos            — list video bookmarks
```

**New DTOs** in `src/modules/admin/dto/`:
- `AdminVideoBookmarkResponseDto`
- `AdminVideoBookmarkListResponseDto`

---

## Phase 8 — Admin Videos Controller

**New file:** `src/modules/admin/controllers/videos-admin.controller.ts`

```
GET    /admin/videos        — list all (cross-client if allClientsAccess)
GET    /admin/videos/:id    — get single
DELETE /admin/videos/:id    — delete
PATCH  /admin/videos/:id    — update metadata
POST   /admin/videos/upload — admin upload
```

Use `assertClientAccess()` + `buildClientWhere()` from `admin-access.helper.ts`.

Register in `src/modules/admin/admin.module.ts`.

---

## Phase 9 — Cleanup Job

**New file:** `src/modules/video/jobs/video.cleanup.job.ts`

Mirror `image.cleanup.job.ts`:
- Find video dirs in storage with no matching DB record → delete
- Cron decorator commented out by default
- Inject `StorageService` + `PrismaService` directly

---

## Phase 10 — App Registration

**File:** `src/modules/app/app.module.ts`

Add `VideoModule` to imports array.

---

## Phase 11 — Config & Env

**File:** `src/configs/config.validation.ts` + `config.schema.ts`

```
MAX_VIDEO_SIZE          — bytes, e.g. 524288000 (500MB)
VIDEO_THUMBNAIL_QUALITY — default 80
```

Add to `.env.example`.

---

## Phase 12 — Nginx Configuration

### Concept

`X-Accel-Redirect` lets NestJS handle auth only. Nginx intercepts the header
and serves the file from disk directly — Node.js process freed immediately,
no video bytes pass through Node.js memory.

```
Client ──► Nginx ──► NestJS (auth check only)
                ◄── X-Accel-Redirect: /internal-videos/...
           Nginx serves file from disk directly
```

### Nginx config changes

Add an `internal` location block inside the server block that serves FileHarbor:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Existing proxy to NestJS
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

            # proxy_pass_header X-Accel-Redirect is NOT needed:
        # Nginx reads X-Accel-* headers from upstream automatically.
        # Add only if your config has proxy_hide_header X-Accel-Redirect.
    }

    # Upload endpoint: raise body size limit for video
    # Default client_max_body_size is 1MB — without this, Nginx returns 413
    # before NestJS even sees the request
    location ~ ^/v2/videos/upload {
        client_max_body_size 600m;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;   # large upload can take time
        proxy_send_timeout 300s;
    }

    # Internal-only location — clients cannot access this directly
    # alias must point to the STORAGE_PATH value from .env
    location /internal-videos/ {
        internal;
        alias /absolute/path/to/storage/;

        # Nginx handles Range natively — no config needed
        # Optional: disable access log for video bytes (high volume)
        access_log off;
    }
}
```

### Key rules

| Rule | Why |
|------|-----|
| `internal;` is mandatory | blocks direct client access to `/internal-videos/` |
| `alias` path must end with `/` | Nginx strips the location prefix, alias replaces it |
| `alias` must match `STORAGE_PATH` exactly | path mismatch → 404 |
| `client_max_body_size 600m` on upload location | default 1MB → 413 before NestJS sees request |
| `proxy_read_timeout 300s` on upload location | large file upload can exceed default 60s timeout |
| `proxy_pass_header X-Accel-Redirect` NOT needed | Nginx reads X-Accel-* from upstream automatically |

### Path mapping example

```
Video.storagePath = "example.com/videos/abc-123"

X-Accel-Redirect: /internal-videos/example.com/videos/abc-123/original.mp4

Nginx resolves: /absolute/path/to/storage/example.com/videos/abc-123/original.mp4
```

So `storagePath` in DB must store the relative path from `STORAGE_PATH` root,
e.g. `{domain}/videos/{videoId}` — not the absolute path.

### Test Nginx config before deploying

```bash
nginx -t                  # validate config syntax
nginx -s reload           # reload without downtime
```

### Dev environment

`X-Accel-Redirect` is ignored outside Nginx (direct Node.js). Controller
detects `NODE_ENV !== 'production'` and falls back to `fs.createReadStream()`
with Range headers. No Nginx needed locally.

---

## Implementation Order

```
1.  Schema migration (manual)                     (Phase 1)
2.  StorageService path helpers                   (Phase 2)
3.  pnpm add fluent-ffmpeg + thumbnail method     (Phase 3)
4.  Tag utils extension                           (Phase 4)
5.  Config env vars                               (Phase 11)
6.  VideoModule DTOs + Service + Controller       (Phase 5)
7.  Webhook events                                (Phase 6)
8.  App registration + smoke test upload          (Phase 10)
9.  Nginx config update on server                 (Phase 12)
10. Bookmarks extension                           (Phase 7)
11. Admin videos controller                       (Phase 8)
12. Cleanup job                                   (Phase 9)
```

---

## Key Constraints

- Never use `npm`/`yarn` — `pnpm` only
- All Prisma queries scoped with `where: { clientId }`
- Webhooks non-blocking: `.catch(error => this.logger.warn(...))`
- Responses via `plainToInstance(Dto, data, { excludeExtraneousValues: true })`
- `@UseInterceptors(ClientInterceptor)` at controller class level
- `MAX_VIDEO_SIZE` validated at boundary (multer), not in service
- No Sharp for video processing — ffmpeg for thumbnail only
- `storagePath` in DB stores relative path from `STORAGE_PATH` root (not absolute)
- Storage layout: `storage/{domain}/videos/{videoId}/original.mp4` + `thumb.webp`
- `Video` model has no `album` relation in MVP — out of scope
- `ffmpeg-static` include il binario — nessun `apt install`, nessuna modifica Dockerfile
