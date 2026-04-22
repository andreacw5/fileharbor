# Deployment – Docker

This guide covers deploying FileHarbor 2.0 in production using Docker and Docker Compose.

---

## Prerequisites

- Docker 24+
- Docker Compose v2+
- A PostgreSQL 15+ database (can be run via Compose)

---

## Docker Image

The Dockerfile uses a **multi-stage build**:

1. **Builder stage** (`node:24.13.0`) – installs dependencies, generates Prisma client, compiles TypeScript
2. **Production stage** (`node:24.13.0-slim`) – minimal runtime image, runs as non-root user (`app:app`, UID/GID 1001)

### Build Manually

```bash
docker build -t fileharbor:latest .
```

---

## Docker Compose (Recommended)

Create a `docker-compose.yml` file:

```yaml
version: '3.9'

services:
  fileharbor:
    image: fileharbor:latest
    # Or build from source:
    # build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      API_PREFIX: v2
      BASE_URL: https://your-domain.com

      # Database
      DATABASE_URL: postgresql://fileharbor:password@db:5432/fileharbor

      # Storage
      STORAGE_PATH: /data/storage
      MAX_FILE_SIZE: 10485760          # 10 MB
      ALLOWED_IMAGE_TYPES: image/jpeg,image/png,image/webp,image/gif

      # Image Processing
      THUMBNAIL_SIZE: 800
      ORIGINAL_QUALITY: 100
      THUMBNAIL_QUALITY: 70
      COMPRESSION_QUALITY: 90

      # Rate Limiting
      THROTTLE_TTL: 60
      THROTTLE_LIMIT: 100

      # Admin
      ADMIN_SECRET: change-me-in-production
      ADMIN_DEFAULT_EMAIL: admin@your-domain.com
      ADMIN_DEFAULT_PASSWORD: change-me-in-production
      ADMIN_DEFAULT_NAME: Super Admin

      # Admin JWT
      JWT_ADMIN_SECRET: change-me-in-production
      JWT_ADMIN_EXPIRES_IN: 8h
      JWT_ADMIN_REFRESH_SECRET: change-me-refresh-production
      JWT_ADMIN_REFRESH_EXPIRES_IN: 7d

      # Logging
      LOG_LEVEL: info

    volumes:
      - fileharbor_storage:/data/storage
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: fileharbor
      POSTGRES_USER: fileharbor
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fileharbor"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  fileharbor_storage:
  postgres_data:
```

### Start

```bash
docker compose up -d
```

### Run Migrations

After the first start, apply database migrations:

```bash
docker compose exec fileharbor node dist/main.js -- prisma migrate deploy
```

Or run migrations before starting by adding an entrypoint script that runs `prisma migrate deploy` before `node dist/main.js`.

---

## Storage Volume

FileHarbor writes all image files to `STORAGE_PATH` (default `./storage`). In Docker, mount this as a **named volume** or a **bind mount** so data persists across container restarts.

```yaml
volumes:
  - /host/path/to/storage:/data/storage
```

The container runs as UID/GID `1001`. Ensure the host directory has the correct permissions:

```bash
sudo chown -R 1001:1001 /host/path/to/storage
```

---

## Reverse Proxy (Nginx Example)

Place Nginx in front of FileHarbor for TLS termination and caching:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    # Cache served images
    location /v2/images/ {
        proxy_pass http://fileharbor:3000;
        proxy_cache images_cache;
        proxy_cache_valid 200 1d;
        proxy_cache_use_stale error timeout updating;
        add_header X-Cache-Status $upstream_cache_status;
    }

    location / {
        proxy_pass http://fileharbor:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Health Check

```bash
curl http://localhost:3000/v2/status
```

Expected response:
```json
{
  "status": "ok",
  "version": "2.x.x",
  "timestamp": "..."
}
```

---

## Prometheus Metrics

Metrics are exposed at:

```
http://localhost:3000/metrics
```

Configure your Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: fileharbor
    static_configs:
      - targets: ['fileharbor:3000']
    metrics_path: /metrics
```

---

## Updating

```bash
# Pull new image
docker pull fileharbor:latest

# Restart with new image
docker compose up -d --no-deps fileharbor

# Apply any new migrations
docker compose exec fileharbor npx prisma migrate deploy
```

