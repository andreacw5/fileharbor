# FileHarbor 2.0 – Wiki

Welcome to the **FileHarbor 2.0** documentation.

FileHarbor is a **multi-tenant image management API** built with NestJS 10, Prisma ORM, and PostgreSQL. It provides secure, scalable image storage with automatic WebP conversion, on-demand resizing, avatar management, album organisation, and a full admin portal.

---

## 📖 Table of Contents

| Page                                     | Description                                    |
|------------------------------------------|------------------------------------------------|
| [Home](Home)                             | This page – overview and quick start           |
| [Architecture](Architecture)             | System design, modules, multi-tenancy          |
| [Authentication](Authentication)         | API Key, User identity, Admin JWT              |
| [API Reference](API-Reference)           | All endpoints grouped by module                |
| [Image Processing](Image-Processing)     | Upload pipeline, WebP conversion, resizing     |
| [Albums](Albums)                         | Album creation, privacy, token access          |
| [Avatars](Avatars)                       | Avatar lifecycle per user                      |
| [Admin Portal](Admin-Portal)             | Admin JWT auth, roles, cross-client operations |
| [Webhooks](Webhooks)                     | Discord webhook events                         |
| [Deployment – Docker](Deployment-Docker) | Production Docker deployment guide             |
| [Configuration](Configuration)           | All environment variables                      |
| [Storage Layout](Storage-Layout)         | On-disk directory structure                    |

---

## ⚡ Quick Start (Development)

```bash
# 1. Clone and install (pnpm only)
git clone https://github.com/your-org/fileharbor.git
cd fileharbor
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env – at minimum set DATABASE_URL, ADMIN_SECRET, JWT_ADMIN_SECRET

# 3. Run database migrations
pnpm run prisma:migrate

# 4. Start development server
pnpm run start:dev
```

- **Swagger UI**: http://localhost:3000/docs  
- **Prometheus metrics**: http://localhost:3000/metrics  
- **Health check**: `GET /v2/status`

---

## 🏗️ Tech Stack

| Layer            | Technology                                 |
|------------------|--------------------------------------------|
| Framework        | NestJS 10 (Node.js / TypeScript)           |
| Database         | PostgreSQL via Prisma ORM                  |
| Image processing | Sharp                                      |
| Auth             | API Keys + Admin JWT (RS/HS256)            |
| Package manager  | pnpm                                       |
| Testing          | Jest                                       |
| API docs         | Swagger / OpenAPI                          |
| Metrics          | Prometheus (`@willsoto/nestjs-prometheus`) |

