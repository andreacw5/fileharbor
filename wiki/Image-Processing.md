# Image Processing

FileHarbor uses the **Sharp** library for all image operations, providing fast, high-quality processing via libvips.

---

## Upload Pipeline

When an image is uploaded via `POST /v2/images`, the following steps occur automatically:

```
1. Validate MIME type (JPEG, PNG, WebP, GIF allowed by default)
2. Validate file size (MAX_FILE_SIZE limit)
3. Process with Sharp:
   a. Convert to WebP (original quality)
   b. Generate thumbnail (THUMBNAIL_SIZE, thumbnail quality)
4. Save both files to storage:
   storage/{domain}/images/{imageId}/original.webp
   storage/{domain}/images/{imageId}/thumb.webp
5. Persist metadata to PostgreSQL
6. Fire webhook (non-blocking)
7. Return ImageResponseDto
```

### Supported Input Formats

| Format | MIME Type |
|--------|-----------|
| JPEG | `image/jpeg` |
| PNG | `image/png` |
| WebP | `image/webp` |
| GIF | `image/gif` |

All inputs are **converted to WebP** on storage.

---

## On-Demand Resizing

Use query parameters when retrieving an image:

```
GET /v2/images/{id}?w=400&h=300&q=80&format=jpeg
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `w` | number | Output width in pixels |
| `h` | number | Output height in pixels |
| `q` | number | Quality (1–100) |
| `format` | string | `webp`, `jpeg`, `png` |
| `thumb` | boolean | Serve thumbnail instead of original |

Resizing is performed in-memory by Sharp on each request and is **not cached on disk** — use a CDN or reverse proxy cache in production.

---

## Thumbnails

A thumbnail is generated **at upload time** alongside the original. The thumbnail size is controlled by `THUMBNAIL_SIZE` (default: `800`px longest edge).

Access the thumbnail:
```
GET /v2/images/{id}?thumb=true
GET /v2/avatars/{userId}?thumb=true
```

---

## Quality Settings

| Environment Variable | Default | Applies To |
|----------------------|---------|------------|
| `ORIGINAL_QUALITY` | `100` | Original file WebP quality |
| `THUMBNAIL_QUALITY` | `70` | Thumbnail WebP quality |
| `COMPRESSION_QUALITY` | `90` | Job-based re-compression |
| `THUMBNAIL_SIZE` | `800` | Max dimension for thumbnails |

---

## EXIF Removal

All metadata (EXIF, GPS, copyright) is **stripped** by Sharp during processing to protect user privacy.

---

## Fallback Images

When an image is not found or access is denied on a non-`info` request, FileHarbor returns a fallback WebP image instead of a HTTP 4xx error. This allows `<img>` tags in frontends to always display something.

| Condition | Fallback File |
|-----------|--------------|
| Image not found | `fileharbor_not_found.webp` |
| Access denied | `fileharbor_permission_denided.webp` |

Fallback images are stored in `storage/defaults.fileharbor/`.

---

## Scheduled Optimization Jobs

The Job module runs background tasks to optimize images that were uploaded before optimization was applied. Jobs are scheduled with cron expressions.

| Job | Description |
|-----|-------------|
| Image cleanup | Removes orphaned image files |
| Avatar cleanup | Removes orphaned avatar files |
| Album cleanup | Removes orphaned album data |

> Cron decorators are currently commented out. To enable, add `@Cron(CronExpression.EVERY_HOUR)` to the job methods.

