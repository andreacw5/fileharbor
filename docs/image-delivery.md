# Image delivery — variants, blur, regenerate, URL prefix

Dettaglio di `GET /images/:id` e delle renditions. Riassunto in [`CLAUDE.md`](../CLAUDE.md).

## API Versioning

`API_PREFIX` (default empty → `POST /images`) is the single source of truth: `config.schema.ts` `apiPrefix` drives
`setGlobalPrefix` in `main.ts` (`/health/*` excluded) **and** every returned `url`/`fullPath` via `RouteHelperService`
(`src/utils/route.utils.ts`). Never concatenate a prefix by hand.

`path()` gives the relative `url`/`thumbnailUrl`/`shareUrl`/album token `url` (`/{prefix}/...`);
`fullUrl()` = `BASE_URL + path()` gives `fullPath`.

**Prod (behind nginx)**: nginx serves `https://fileharbor.heyatom.dev/v2/...` and strips `/v2` before
proxying, so `API_PREFIX` stays **empty** and the public prefix lives in `BASE_URL=https://fileharbor.heyatom.dev/v2`.
Result: routes unprefixed, `fullPath` public (`.../v2/images/<id>`), relative fields bare (`/images/<id>`, no `/v2`).
Setting `API_PREFIX=v2` there would make the app serve `/v2/...` while nginx forwards `/images/...` → 404.

## Image Processing

Sharp handles all transformations. Inputs: JPEG, PNG, WebP, GIF. Storage always WebP. Operations:
- Auto WebP conversion + thumbnail generation on upload
- On-demand resize via query params
- EXIF removal
- Quality set from env vars
- Animated GIF/WebP stay animated (animated WebP original, thumb, variants, optimize). JPEG/PNG renders
  take the first frame. `MAX_INPUT_PIXELS` counts all frames. Tinify refuses animated originals (`400`):
  it would overwrite them with a single frame.

### On-demand variants — bounded by design

`GET /images/:id` is public and `@SkipThrottle()`, so its transforms are bounded instead of rate-limited:

- **Delivery**: a file already on disk is never read into memory. With `IMAGE_X_ACCEL_REDIRECT=true` the
  controller answers `X-Accel-Redirect: /internal-images/<storage-relative path>` and nginx serves it;
  otherwise Node streams it (`createReadStream`, `Content-Length` from `stat`). Videos use the same
  hand-off only when the request carries `X-Original-URI` (our nginx sets it, Meridian's BFF on the Docker
  network does not): the flag alone would answer an internal caller with an empty body. Only a fresh render (or a blur
  resized per request) comes back as a buffer. Prod keeps X-Accel **off** for images on purpose: nginx never
  `proxy_cache`s an X-Accel response, and the image cache (HIT = no upstream, no DB) is worth more. Videos use
  it (`VIDEO_X_ACCEL_REDIRECT=true`).

- **Snapped, never rejected** (`image/image-variants.ts`): width/height round **up** to the next of
  `VARIANT_SIZES` (16 … 4096), quality to the nearest of `VARIANT_QUALITIES` (40/60/75/85/100). Old URLs
  keep working; close values share one cached file and one ETag (the controller snaps too).
- **Cache**: at most `MAX_CACHED_VARIANTS` (20) files under `{imageDir}/variants/`; past that a variant is
  rendered but not stored. Concurrent misses on one variant (or one blur) share a single render
  (`ImageService.dedupe`, keyed on the target path). A variant that fits inside the thumb (both dims ≤
  `THUMBNAIL_SIZE`, quality < 100) is cut from `thumb.webp` (q70 source, ~10x less to decode); larger or q100
  ones from the original. `sharp.concurrency` is set once to `cpus / RENDER_CONCURRENCY`, `UV_THREADPOOL_SIZE=8`
  in the Dockerfile.
- **`srcset`** (`buildSrcset`, plan 09): `ImageResponseDto` and album image items carry a ready-made
  `srcset` built on `fullPath` (absolute): the fixed `SRCSET_WIDTHS` (320/640/960/1280/1920) strictly below
  the original width, then the original itself (no render, no cache slot). Omitted for private images.
- **Render cap**: every `StorageService.resizeImage` call (image variants and avatar jpeg/png conversion,
  which is never cached) goes through a `Semaphore` (`utils/semaphore.ts`): `RENDER_CONCURRENCY` (default 2)
  at once, `RENDER_QUEUE_LIMIT` (default 200: a gallery page asks for 50-100 cold variants at once, and waiters hold no bytes,
  the variant source is read only once the slot is acquired) waiting, the rest get `503` with `Retry-After: 1`
  (`RenderBusyException`: its `retryAfterSeconds: 1` becomes the header only, never the body). A view is counted only after the file is served. The optimize jobs don't
  use it; upload and regenerate do, for the blurred preview only (best-effort: a full queue skips it).
- **Blurred preview** (plan 11, `?blur=1`): `blurred.webp` beside the thumb, a rendition and not an access rule:
  same access as the original (`validateImageAccess` unchanged), except `Image.blurPublic` (owner-set, upload or
  `PATCH`), which serves the preview to anyone with `public, immutable`. Effective `blur = blur && !info && !download`;
  with it `thumb`/`quality` are ignored, `width`/`height` (`snapBlurSize`: from 480 up they are dropped, the file is already that size) and `format` resize/convert per request (never cached), ETag variant `blur` (`blur-<w>-<h>-<format>` when any applies), never a view (304 included). `StorageService.blurImage`:
  two passes (32 px `toBuffer()`, then 480 px + `blur(6)`), because sharp keeps one `resize()` per pipeline and a
  single pass would blur the full source; constants in `image-variants.ts`, `BLUR_SOURCE_SIZE` is the knob. Source is
  the thumb (original only if the thumb is gone), first frame. Pre-generated only where a site shows it: on upload when
  `isPrivate || blurPublic`, after a `PATCH` (client or admin) that leaves it private or `blurPublic` (fire-and-forget,
  only if missing); public images get it on the first `?blur=1`. All best-effort; built and saved on the fly when
  missing, behind `renderLimiter`. Eager for private ones because a gallery's first visit would otherwise 503 past the
  render queue. The branch is closed:
  `422`/`503`, **never** a fall-through to the original. Not in storage bytes or metrics.
- **Regenerate** (plan 06): `POST admin/images/:id/regenerate` rebuilds `thumb.webp` (and `blurred.webp` if one exists, best-effort) from the
  stored original and empties `variants/`; id, original, `size` and optimize state are untouched, `updatedAt` moves last (ETag). `404`
  without an original, `422` when it is unreadable. Public GETs are `immutable`: a cache holding the old thumb keeps
  it, so the console reloads with `?t=<updatedAt>`. `POST admin/videos/:id/regenerate` is the video counterpart
  (`VideoService.regenerateThumbnail`): `thumb.webp` from the first frame at `VIDEO_THUMBNAIL_QUALITY`, same codes,
  `fh_video.regenerated`. Avatars re-upload on the same URL.

