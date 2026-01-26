<p align="center">
  <a href="https://github.com/andreacw5/fileharbor" target="blank"><img src="app_logo.png" width="500" alt="File Harbor App Logo" /></a>
</p>

<p align="center">
Multi-tenant image management system built with NestJS 10, Prisma ORM, and PostgreSQL.
</p>
<p align="center">
    <a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@andreacw5/fileharbor" alt="NPM Version" /></a>
    <a href="https://github.com/andreacw5/fileharbor/blob/main/LICENSE.md" target="_blank"><img alt="GitHub License" src="https://img.shields.io/github/license/andreacw5/fileharbor"></a>
</p>

## Features

✅ **Multi-tenant Architecture**: Complete isolation between clients with API key authentication  
✅ **Image Management**: Upload, store, and serve images with automatic WebP conversion  
✅ **Avatar System**: Single avatar per user with automatic replacement  
✅ **Album Support**: Organize images in public or private albums  
✅ **Automatic Optimization**: Scheduled jobs for compression and EXIF removal  
✅ **On-Demand Resizing**: Generate custom sizes and formats on the fly  
✅ **Secure Access**: Token-based access for private albums  
✅ **Rate Limiting**: Built-in throttling protection  
✅ **API Documentation**: Auto-generated Swagger/OpenAPI docs  

## Tech Stack

- **Framework**: NestJS 10 (Node.js/TypeScript)
- **Database**: PostgreSQL with Prisma ORM
- **Image Processing**: Sharp library
- **Authentication**: JWT tokens, API Keys
- **Package Manager**: pnpm (enforced via preinstall script)
- **Testing**: Jest
- **API Documentation**: Swagger/OpenAPI
- **Caching**: HTTP ETag & Cache-Control headers
- **Storage**: Local file system (extensible to S3/Cloud)

## Installation

```bash
# Install dependencies (pnpm only)
pnpm install

# Setup database
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
pnpm run prisma:generate

# Run migrations
pnpm run prisma:migrate

# Seed database with demo data (optional)
pnpm run prisma:seed
```

## Running the App

```bash
# Development mode with hot reload
pnpm run start:dev

# Production build
pnpm run build
pnpm run start:prod
```

The API will be available at `http://localhost:3000`

## API Documentation

Complete API documentation with interactive testing interface:
- **Swagger UI**: `http://localhost:3000/docs`

All endpoints, request/response schemas, and examples are available in the Swagger documentation.

## Architecture

### Multi-Tenant Flow

1. Client sends request with `X-API-Key` header (validates and retrieves client - REQUIRED)
2. `ClientInterceptor` validates and attaches client info to request
3. All queries are scoped to `clientId`
4. User isolation via `X-User-Id` header for user-specific operations

**Security Note**: Only API Key authentication is supported.

### Storage Structure

```
storage/
├── {domain}/
│   ├── images/
│   │   └── {imageId}/
│   │       ├── original.webp
│   │       └── thumb.webp
│   └── avatars/
│       └── {userId}/
│           ├── avatar.webp
│           └── thumb.webp
```

## Request Headers

### Required Headers

```
X-API-Key: {your-api-key}           # Required for authentication
X-User-Id: {externalUserId}         # Required for user-specific operations
```


## Optimization Jobs

The system runs hourly jobs to:
- Convert images to WebP format
- Remove EXIF metadata
- Compress images
- Generate optimized thumbnails

Jobs run automatically via NestJS Schedule module.

## Configuration

Key environment variables in `.env`:

```env
# Server
APP_PORT=3000
APP_URL=http://localhost:3000
API_PREFIX=v2

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/fileharbor?schema=public"

# Storage
STORAGE_PATH=./storage
MAX_FILE_SIZE=10485760  # 10MB

# Image Processing
WEBP_QUALITY=90
JPEG_QUALITY=85
THUMBNAIL_SIZE=300

# Rate Limiting
THROTTLE_TTL=60         # seconds
THROTTLE_LIMIT=10       # requests per TTL

# Caching
CACHE_TTL=60           # seconds

# Logging (optional)
LOGS_TOKEN=your-betterstack-token
```

## Database Schema

### Main Entities

- **Client**: Multi-tenant clients with API keys
- **User**: Users within each client
- **Image**: Image metadata and storage paths
- **Avatar**: Single avatar per user
- **Album**: Image collections (public/private)
- **AlbumImage**: Many-to-many relation
- **AlbumToken**: Access tokens for private albums

## Security Features

- API key authentication for clients
- User-level authorization
- Token-based album access
- Rate limiting on all endpoints
- EXIF data sanitization
- File type validation
- Size limits on uploads

## Performance Optimizations

- ETag caching for static assets
- Cache-Control headers
- On-demand image generation
- Batch processing for optimization jobs
- Database indexing on frequently queried fields

## Development

```bash
# Watch mode
pnpm run start:dev

# Run tests
pnpm run test
pnpm run test:watch
pnpm run test:cov

# E2E tests
pnpm run test:e2e

# Linting and formatting
pnpm run lint
pnpm run format

# Prisma Studio (DB GUI)
pnpm run prisma:studio

# Generate migration
pnpm run prisma:migrate
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure PostgreSQL connection
3. Set up file storage (local or cloud)
4. Configure reverse proxy (Nginx)
5. Enable SSL/TLS
6. Set up monitoring and logging
7. Configure `API_PREFIX` if different from default (v2)

## Roadmap

### 🚀 Core Features
- [ ] **Advanced Image Transformations**: Watermarks, filters, blur, grayscale, sepia effects
- [ ] **Batch Upload API**: Multiple image upload in single request with progress tracking
- [ ] **Image Collections**: Extended album functionality with sorting, filtering, and bulk operations

### 📊 Analytics & Monitoring
- [ ] **Enhanced Analytics Dashboard**: Real-time usage metrics, popular images, client statistics
- [ ] **Performance Metrics**: API response times, optimization job statistics, storage usage trends
- [ ] **Client Usage Reports**: Bandwidth consumption, storage quotas, API call analytics

### 🔐 Security & Authentication
- [ ] **API Rate Limiting per Client**: Individual throttling limits based on client subscription
- [ ] **Audit Logging**: Complete action history for compliance and security monitoring

### 🎨 Advanced Image Processing
- [ ] **AI-Powered Features**: Auto-tagging, content moderation, duplicate detection
- [ ] **Dynamic Watermarking**: Configurable watermarks per client with position/opacity controls
- [ ] **Format-Specific Optimizations**: AVIF support, progressive JPEG, animated WebP
- [ ] **Face Detection & Cropping**: Smart avatar cropping and face-based image optimization

### 🔗 Integrations & API
- [ ] **WebSocket Support**: Real-time notifications for upload progress, optimization status
- [ ] **Webhook System**: Client notifications for image events (upload, optimization, deletion)
- [ ] **CDN Integration**: CloudFlare, AWS CloudFront integration for global distribution

### 📱 User Experience
- [ ] **Image Search & Filtering**: Advanced search by tags, date ranges, formats, sizes
- [ ] **Bulk Operations Dashboard**: Mass deletion, optimization, and metadata editing

### 🏗️ Infrastructure & Performance
- [ ] **Caching Layer**: Redis caching for frequently accessed images

### 🌐 Enterprise Features
- [ ] **SSO Integration**: SAML/OAuth2 integration for enterprise client authentication
- [ ] **Compliance Features**: GDPR data export/deletion, audit trails, data encryption
- [ ] **White-Label Solution**: Custom branding and domain configuration per client

### 🔄 Automation & Intelligence
- [ ] **Smart Cleanup**: Auto-deletion of unused images based on configurable policies
- [ ] **Predictive Optimization**: Machine learning for optimal compression settings
- [ ] **Content Insights**: Usage analytics and recommendations for image management

## License

MIT

## Support

For issues and questions, please open a GitHub issue.

