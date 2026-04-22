# API Reference

All endpoints are prefixed with `/v2` by default (configurable via `API_PREFIX` env var).

**Common headers:**

| Header                          | Required          | Description            |
|---------------------------------|-------------------|------------------------|
| `X-API-Key`                     | Yes (non-admin)   | Client API key         |
| `X-User-Id`                     | Context-dependent | External user ID       |
| `Authorization: Bearer <token>` | Yes (admin)       | Admin JWT access token |

Full interactive docs are available at `http://localhost:3000/docs` (Swagger UI).

---

## Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v2/images` | Upload a new image (multipart/form-data) |
| `GET` | `/v2/images` | List images with filtering and pagination |
| `GET` | `/v2/images/:id` | Retrieve / serve an image (WebP or resized) |
| `GET` | `/v2/images/:id?info=true` | Get image metadata (JSON) |
| `PATCH` | `/v2/images/:id` | Update image metadata (tags, description, privacy) |
| `DELETE` | `/v2/images/:id` | Delete an image |
| `POST` | `/v2/images/:id/share` | Create a share link for a private image |
| `GET` | `/v2/images/share/:token` | Access a shared private image via token |

### Upload Parameters (`POST /v2/images`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | Image file (JPEG, PNG, WebP, GIF) |
| `albumId` | string | No | Album UUID to add the image to |
| `tags` | string[] | No | Array of text tags |
| `description` | string | No | Image description |
| `isPrivate` | boolean | No | Default: `false` |

### Retrieve Parameters (`GET /v2/images/:id`)

| Query Param | Type | Description |
|-------------|------|-------------|
| `w` | number | Resize width |
| `h` | number | Resize height |
| `q` | number | Quality (1–100) |
| `format` | string | Output format (e.g. `jpeg`, `webp`, `png`) |
| `thumb` | boolean | Return thumbnail |
| `t` | string | Cache-busting timestamp |
| `token` | string | Access token for private images |

> For private images, either the owner's `X-User-Id` or a valid `token` query parameter is required. Non-info requests on inaccessible images return a fallback WebP image instead of a 4xx error.

---

## Avatars

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v2/avatars` | Upload or replace user avatar |
| `GET` | `/v2/avatars/:externalUserId` | Retrieve user avatar |
| `DELETE` | `/v2/avatars/:externalUserId` | Delete user avatar |

### Upload Parameters (`POST /v2/avatars`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | Yes | Image file |
| `externalUserId` | string | Yes | Target user ID |

Each user can have only **one** avatar. Uploading a new one replaces the existing one.

---

## Albums

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v2/albums` | Create a new album |
| `GET` | `/v2/albums` | List albums (paginated) |
| `GET` | `/v2/albums/:id` | Get album details |
| `PATCH` | `/v2/albums/:id` | Update album metadata |
| `DELETE` | `/v2/albums/:id` | Delete an album |
| `POST` | `/v2/albums/:id/images` | Add images to album |
| `DELETE` | `/v2/albums/:id/images` | Remove images from album |
| `GET` | `/v2/albums/:id/images` | List images in album |
| `POST` | `/v2/albums/:id/tokens` | Create access token for private album |
| `DELETE` | `/v2/albums/:id/tokens/:token` | Revoke an album token |

### Create Album (`POST /v2/albums`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Album name |
| `description` | string | No | Description |
| `isPublic` | boolean | No | Default: `false` |
| `albumId` | string | No | External album ID from client's system |

`X-User-Id` header is required for album operations.

---

## Client & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v2/status` | Health check + API key info |
| `GET` | `/v2/client/stats` | Client statistics (image count, size, etc.) |

---

## Admin Endpoints

All admin endpoints require `Authorization: Bearer <token>`. See [Admin Portal](Admin-Portal) for details.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v2/admin/auth/login` | Login, get access token |
| `POST` | `/v2/admin/auth/refresh` | Refresh access token |
| `POST` | `/v2/admin/auth/logout` | Logout |
| `GET` | `/v2/admin/auth/me` | Get own profile |
| `PATCH` | `/v2/admin/auth/me` | Update own profile |
| `POST` | `/v2/admin/auth/me/change-password` | Change password |
| `GET` | `/v2/admin/stats` | Global + per-client statistics |
| `GET` | `/v2/admin/clients` | List all clients |
| `GET` | `/v2/admin/clients/:id` | Get client details |
| `PATCH` | `/v2/admin/clients/:id` | Update client |
| `POST` | `/v2/admin/images` | Upload image on behalf of a client |
| `GET` | `/v2/admin/images` | List images across accessible clients |
| `GET` | `/v2/admin/images/tags` | List tags with optional search/limit |
| `GET` | `/v2/admin/images/:id` | Get image details |
| `PATCH` | `/v2/admin/images/:id` | Update image metadata |
| `DELETE` | `/v2/admin/images/:id` | Delete image |
| `GET` | `/v2/admin/avatars` | List avatars |
| `GET` | `/v2/admin/avatars/:id` | Get avatar details |
| `DELETE` | `/v2/admin/avatars/:id` | Delete avatar |
| `GET` | `/v2/admin/albums` | List albums |
| `GET` | `/v2/admin/albums/:id` | Get album details |
| `PATCH` | `/v2/admin/albums/:id` | Update album |
| `DELETE` | `/v2/admin/albums/:id` | Delete album |

