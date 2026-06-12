# Graph Report - fileharbor  (2026-06-11)

## Corpus Check
- 156 files · ~71,517 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 956 nodes · 1787 edges · 60 communities (55 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f073b505`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]

## God Nodes (most connected - your core abstractions)
1. `AdminJwtPayload` - 67 edges
2. `PrismaService` - 44 edges
3. `AlbumService` - 41 edges
4. `ImageService` - 40 edges
5. `StorageService` - 39 edges
6. `assertClientAccess()` - 37 edges
7. `ClientService` - 25 edges
8. `AvatarService` - 21 edges
9. `UserService` - 21 edges
10. `compilerOptions` - 19 edges

## Surprising Connections (you probably didn't know these)
- `CreateUserAdminDto` --inherits--> `CreateUserDto`  [EXTRACTED]
  src/modules/admin/dto/create-user-admin.dto.ts → src/modules/user/dto/create-user.dto.ts
- `ListImagesResponseDto` --references--> `ImageResponseDto`  [EXTRACTED]
  src/modules/image/dto/list-images-response.dto.ts → src/modules/image/dto/image-response.dto.ts
- `TinifyCompressionResponseDto` --references--> `ImageResponseDto`  [EXTRACTED]
  src/modules/image/dto/tinify-compression-response.dto.ts → src/modules/image/dto/image-response.dto.ts
- `ListImagesResponseDto` --references--> `PaginationMetaDto`  [EXTRACTED]
  src/modules/image/dto/list-images-response.dto.ts → src/modules/image/dto/pagination-meta.dto.ts

## Import Cycles
- None detected.

## Communities (60 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (17): BastionTokenResponse, ClientInitService, CreateAlbumDto, BastionJwtPayload, formatFileSize(), TinifyResetJob, PrismaService, StorageCleanupJob (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (14): CreateShareLinkDto, DeleteResponseDto, GetImageDto, ImageResponseDto, ListImagesDto, ListImagesResponseDto, PaginationMetaDto, ShareLinkResponseDto (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (18): ClientController, ClientService, UsersAdminController, ClientId, ExternalUserId, User, UserId, Public() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (20): AdminInitService, AdminModule, AdminAuthModule, AlbumModule, AppModule, StatusController, AvatarModule, BookmarksModule (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (45): devDependencies, eslint, eslint-config-prettier, eslint-plugin-prettier, jest, @nestjs/cli, @nestjs/schematics, @nestjs/testing (+37 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (3): AlbumCleanupJob, AlbumService, UpdateAlbumDto

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (34): [2.0.0] – 2025-10-29 → 2026-01-14, [2.0.1] – 2026-01-14, [2.0.2] – 2026-01-15, [2.0.3] – 2026-01-19, [2.0.4] – 2026-01-20, [2.0.5] – 2026-01-26, [2.1.0] – 2026-01-27, [2.1.1] – 2026-03-31 (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (8): AlbumController, AlbumImagesResponseDto, AlbumResponseDto, AlbumTokenResponseDto, DeleteAlbumResponseDto, ListAlbumsDto, ListAlbumsResponseDto, ManageAlbumImagesDto

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (7): AvatarCleanupJob, AvatarController, AvatarService, AvatarResponseDto, DeleteAvatarResponseDto, GetAvatarDto, UploadAvatarDto

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (10): AlbumsAdminController, AvatarsAdminController, ImageShareLinksAdminController, ImagesAdminController, AdminAlbumResponseDto, AdminAvatarResponseDto, AdminImageResponseDto, AdminImageShareLinksListResponseDto (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (29): 🎨 Advanced Image Processing, 📊 Analytics & Monitoring, API Documentation, Architecture, 🔄 Automation & Intelligence, Configuration, 🚀 Core Features, Database Schema (+21 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (7): AdminAuthController, AdminAuthService, AdminLoginDto, AdminLoginResponseDto, AdminRefreshResponseDto, AdminUserResponseDto, AdminUpdateProfileDto

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (8): AdminUser, TagListItemDto, TagsResponseDto, UpdateUserAdminDto, AdminJwtGuard, JwksCache, TagController, TagService

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (16): BookmarksAdminController, AdminAlbumImageEntryDto, AdminAlbumUserDto, AdminBookmarkedUserDto, AdminBookmarkListResponseDto, AdminBookmarkResponseDto, AdminClientUserClientDto, AdminDeleteResponseDto (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (24): 1️⃣ Creare un Album con External ID, 2️⃣ Aggiungere Immagini all'Album, 3️⃣ Ottenere Album e Immagini, 4️⃣ Aggiornare Album Metadata, 5️⃣ Rimuovere Immagini dall'Album, Accesso agli Album, 🔑 Autenticazione, Autorizzazione Utente (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (24): dependencies, bcrypt, class-transformer, class-validator, cookie-parser, express, joi, multer (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (11): AdminBookmarksListParams, AdminUserBookmarksListParams, AdminUpdateImageDto, AdminUploadImageDto, buildClientWhere(), resolveAllowedClients(), buildImageTagCreateInput(), extractTagNames() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (17): scripts, build, format, lint, preinstall, prisma:generate, prisma:migrate, prisma:studio (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): Adding a New Feature Module1. Follow existing module structure: `controller` → `service` → `dto/` subdir, Admin Module, Architecture Overview, Auth & Request Context, Config Access, DTO / Response Pattern, FileHarbor 2.0 – Agent Guide, Key Commands (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (12): Build Manually, Deployment – Docker, Docker Compose (Recommended), Docker Image, Health Check, Prerequisites, Prometheus Metrics, Reverse Proxy (Nginx Example) (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.24
Nodes (6): AdminAddImagesToAlbumDto, AdminCreateAlbumDto, AdminRemoveImagesFromAlbumDto, AdminAddImagesToAlbumResponseDto, AdminRemoveImagesFromAlbumResponseDto, AdminUpdateAlbumDto

### Community 23 - "Community 23"
Cohesion: 0.17
Nodes (11): Admin Portal, Authentication, Client Access Control, Key Admin Operations, List / Search Tags, Profile Management, Roles, Security Notes (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (11): Add Images, Albums, Creating Albums, Creating an Access Token, External Album ID, List Album Images, Managing Album Images, Private Albums (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (11): Admin JWT Authentication, Admin Roles & Access Control, Authentication, Client API Key Authentication, Login Flow, Logout, Public Endpoints, Rate Limiting (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (4): AdminStatsResponseDto, DailyDataPointDto, StatisticsController, StatisticsService

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (11): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, moduleNameMapper, rootDir, testEnvironment, testRegex (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (10): Admin Endpoints, Albums, API Reference, Avatars, Client & Status, Create Album (`POST /v2/albums`), Images, Retrieve Parameters (`GET /v2/images/:id`) (+2 more)

### Community 29 - "Community 29"
Cohesion: 0.20
Nodes (9): Admin, Configuration, Database, Example `.env`, Image Processing, Rate Limiting, Required Variables, Server (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (9): EXIF Removal, Fallback Images, Image Processing, On-Demand Resizing, Quality Settings, Scheduled Optimization Jobs, Supported Input Formats, Thumbnails (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.43
Nodes (3): ClientsAdminController, AdminClientResponseDto, AdminUpdateClientDto

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (7): API Documentation, Code Documentation, Documentation, GitHub Copilot Instructions for FileHarbor 2.0, Notes for AI Assistants, Project Overview, Tech Stack

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (7): compilerOptions, module, outDir, target, exclude, extends, include

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (6): author, description, license, name, private, version

### Community 35 - "Community 35"
Cohesion: 0.29
Nodes (6): Architecture, Data Model, Module Map, Multi-Tenancy, Overview, Request Flow

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (6): Avatars, Deleting an Avatar, Optional Query Parameters, Retrieving an Avatar, Storage, Uploading an Avatar

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (6): Directory Structure, Docker Volume Mapping, Fallback Images, Path Safety, Storage Layout, Tenant Directory

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (6): Discord Embed Format, Enabling Webhooks, Failure Handling, Notes, Webhook Events, Webhooks

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (5): Architecture, Features, 📚 FileHarbor Wiki, Getting Started, Reference

### Community 40 - "Community 40"
Cohesion: 0.40
Nodes (5): Code Organization, Code Style & Conventions, Naming Conventions, NestJS Conventions, TypeScript Configuration

### Community 41 - "Community 41"
Cohesion: 0.40
Nodes (5): Common Patterns, Error Handling, File Operations, Image Processing, Multi-Tenant Queries

### Community 42 - "Community 42"
Cohesion: 0.40
Nodes (5): Development Workflow, Environment Setup, Linting & Formatting, Running the Application, Testing

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (4): collection, compilerOptions, deleteOutDir, sourceRoot

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (4): FileHarbor 2.0 – Wiki, ⚡ Quick Start (Development), 📖 Table of Contents, 🏗️ Tech Stack

### Community 45 - "Community 45"
Cohesion: 0.50
Nodes (3): compat, __dirname, __filename

### Community 46 - "Community 46"
Cohesion: 0.50
Nodes (4): API Design, Response Patterns, Swagger Documentation, Versioning

### Community 47 - "Community 47"
Cohesion: 0.50
Nodes (4): Architecture & Patterns, Module Organization, Multi-Tenant Structure, Storage Structure

### Community 48 - "Community 48"
Cohesion: 0.50
Nodes (4): Authentication & Authorization, File Security, Rate Limiting, Security Requirements

### Community 49 - "Community 49"
Cohesion: 0.50
Nodes (4): Best Practices for Contributing, When Adding Features, When Fixing Bugs, When Refactoring

### Community 50 - "Community 50"
Cohesion: 0.50
Nodes (4): Database Guidelines, Entities, Prisma Workflow, Query Patterns

### Community 51 - "Community 51"
Cohesion: 0.50
Nodes (4): E2E Tests, Integration Tests, Testing Strategy, Unit Tests

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (3): Adding Dependencies, Dependencies Management, Key Dependencies

### Community 53 - "Community 53"
Cohesion: 0.67
Nodes (3): Adding New Jobs, Optimization Job, Scheduled Jobs

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (3): Image Processing, Sharp Library Usage, Supported Operations

## Knowledge Gaps
- **324 isolated node(s):** `__filename`, `__dirname`, `compat`, `collection`, `sourceRoot` (+319 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AdminJwtPayload` connect `Community 9` to `Community 0`, `Community 2`, `Community 12`, `Community 13`, `Community 14`, `Community 17`, `Community 21`, `Community 22`, `Community 26`, `Community 31`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `AlbumService` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 7`, `Community 9`, `Community 22`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `PrismaService` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 8`, `Community 10`, `Community 12`, `Community 13`, `Community 17`, `Community 26`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `__filename`, `__dirname`, `compat` to the rest of the system?**
  _324 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06521739130434782 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05257936507936508 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.0576271186440678 - nodes in this community are weakly interconnected._