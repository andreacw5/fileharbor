# Configuration

All configuration is done through environment variables. FileHarbor validates them at startup using Joi — missing required variables will cause the application to fail fast with a clear error message.

---

## Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/db` |
| `ADMIN_SECRET` | Secret key for internal admin operations |
| `JWT_ADMIN_SECRET` | Secret for signing admin access tokens |

---

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `PORT` | `3000` | HTTP port |
| `API_PREFIX` | `v2` | URL prefix for all routes (e.g. `/v2/images`) |
| `BASE_URL` | `http://localhost:3000` | Public base URL, used in generated links |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`, `verbose` |

---

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | **Required.** Full PostgreSQL connection string |

---

## Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_PATH` | `./storage` | Root directory for all stored files |
| `MAX_FILE_SIZE` | `10485760` | Max upload size in bytes (default: 10 MB) |
| `ALLOWED_IMAGE_TYPES` | `image/jpeg,image/png,image/webp,image/gif` | Comma-separated allowed MIME types |

---

## Image Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `THUMBNAIL_SIZE` | `800` | Max dimension (px) for generated thumbnails |
| `ORIGINAL_QUALITY` | `100` | WebP quality for original files (1–100) |
| `THUMBNAIL_QUALITY` | `70` | WebP quality for thumbnails (1–100) |
| `COMPRESSION_QUALITY` | `90` | WebP quality for job-based re-compression (1–100) |

---

## Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_TTL` | `60` | Time window in seconds |
| `THROTTLE_LIMIT` | `10` | Max requests per window per IP |

---

## Admin

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_SECRET` | — | **Required.** Internal admin secret |
| `ADMIN_DEFAULT_EMAIL` | — | Email for the auto-seeded first admin user |
| `ADMIN_DEFAULT_PASSWORD` | — | Password for the auto-seeded first admin user |
| `ADMIN_DEFAULT_NAME` | `Super Admin` | Display name for the first admin |
| `JWT_ADMIN_SECRET` | `change-me-in-production` | Secret for admin access tokens |
| `JWT_ADMIN_EXPIRES_IN` | `8h` | Admin access token lifetime |
| `JWT_ADMIN_REFRESH_SECRET` | — | Secret for admin refresh tokens |
| `JWT_ADMIN_REFRESH_EXPIRES_IN` | — | Refresh token lifetime (e.g. `7d`) |

---

## Example `.env`

```env
# Server
NODE_ENV=production
PORT=3000
API_PREFIX=v2
BASE_URL=https://images.your-domain.com
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://fileharbor:password@localhost:5432/fileharbor

# Storage
STORAGE_PATH=./storage
MAX_FILE_SIZE=10485760
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/webp,image/gif

# Image Processing
THUMBNAIL_SIZE=800
ORIGINAL_QUALITY=100
THUMBNAIL_QUALITY=70
COMPRESSION_QUALITY=90

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# Admin
ADMIN_SECRET=a-strong-random-secret
ADMIN_DEFAULT_EMAIL=admin@your-domain.com
ADMIN_DEFAULT_PASSWORD=a-strong-password
ADMIN_DEFAULT_NAME=Super Admin

# Admin JWT
JWT_ADMIN_SECRET=another-strong-secret
JWT_ADMIN_EXPIRES_IN=8h
JWT_ADMIN_REFRESH_SECRET=yet-another-secret
JWT_ADMIN_REFRESH_EXPIRES_IN=7d
```

