<p align="center">
  <a href="https://github.com/andreacw5/fileharbor" target="blank"><img src="app_logo.png" width="500" alt="File Harbor App Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

<p align="center">
Multi-tenant image management system built with NestJS and Prisma.
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

- **Framework**: NestJS 10
- **Database**: PostgreSQL with Prisma ORM
- **Image Processing**: Sharp
- **Authentication**: JWT, API Keys
- **Caching**: HTTP ETag & Cache-Control headers
- **Storage**: Local file system (extensible to S3/Cloud)

## Installation

```bash
# Install dependencies
npm install

# Setup database
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed database with demo data
npm run prisma:seed
```

## Running the App

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:3000/api/docs`

## Architecture

### Multi-Tenant Flow

1. Client sends request with `X-Client-Id` header or `X-API-Key` header
2. `ClientInterceptor` validates and attaches client info to request
3. All queries are scoped to `clientId`
4. User isolation via `X-User-Id` header

### Storage Structure

```
storage/
├── {clientId}/
│   ├── {imageId}/
│   │   ├── original.webp
│   │   └── thumb.webp
│   └── avatars/
│       └── {userId}/
│           ├── avatar.webp
│           └── thumb.webp
```

## API Endpoints

### Images

```
POST   /v1/images/upload          - Upload image
GET    /v1/images/:id              - Get image (with optional resize params)
GET    /v1/images/:id/thumb        - Get thumbnail
GET    /v1/images/:id/info         - Get image metadata
GET    /v1/images/user/list        - Get user's images
DELETE /v1/images/:id              - Delete image
```

### Avatars

```
POST   /v1/avatars/upload          - Upload/update avatar
GET    /v1/avatars/:userId         - Get avatar
GET    /v1/avatars/:userId/thumb   - Get avatar thumbnail
GET    /v1/avatars/:userId/info    - Get avatar metadata
DELETE /v1/avatars                 - Delete avatar
```

### Albums

```
POST   /v1/albums                  - Create album
GET    /v1/albums                  - Get user albums
GET    /v1/albums/:id              - Get album with images
PUT    /v1/albums/:id              - Update album
DELETE /v1/albums/:id              - Delete album
POST   /v1/albums/:id/images       - Add images to album
DELETE /v1/albums/:id/images/:imgId - Remove image from album
POST   /v1/albums/:id/token        - Generate access token
```

## Request Headers

### Required Headers

```
X-API-Key: demo-api-key-12345
# OR
X-Client-Id: {clientId}

X-User-Id: {externalUserId}  # Required for user-specific operations
```

## Example Usage

### Upload an Image

```bash
curl -X POST http://localhost:3000/v1/images/upload \
  -H "X-API-Key: demo-api-key-12345" \
  -H "X-User-Id: user-001" \
  -F "file=@image.jpg"
```

### Get Image with Custom Size

```bash
curl http://localhost:3000/v1/images/{imageId}?width=400&format=jpeg
```

### Upload Avatar

```bash
curl -X POST http://localhost:3000/v1/avatars/upload \
  -H "X-API-Key: demo-api-key-12345" \
  -H "X-User-Id: user-001" \
  -F "file=@avatar.jpg"
```

### Create Private Album

```bash
curl -X POST http://localhost:3000/v1/albums \
  -H "X-API-Key: demo-api-key-12345" \
  -H "X-User-Id: user-001" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Private Album",
    "description": "Personal photos",
    "isPublic": false
  }'
```

### Generate Album Access Token

```bash
curl -X POST http://localhost:3000/v1/albums/{albumId}/token?expiresInDays=7 \
  -H "X-API-Key: demo-api-key-12345" \
  -H "X-User-Id: user-001"
```

### Access Private Album with Token

```bash
curl http://localhost:3000/v1/albums/{albumId}?token={generatedToken}
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
PORT=3000
API_PREFIX=v1

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/fileharbor?schema=public"

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Storage
STORAGE_PATH=./storage
MAX_FILE_SIZE=10485760  # 10MB

# Image Processing
THUMBNAIL_SIZE=800
WEBP_QUALITY=85
COMPRESSION_QUALITY=90

# Rate Limiting
THROTTLE_TTL=60         # seconds
THROTTLE_LIMIT=10       # requests per TTL
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
npm run start:dev

# Run tests
npm run test

# Prisma Studio (DB GUI)
npm run prisma:studio

# Generate migration
npx prisma migrate dev --name migration_name
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong `JWT_SECRET`
3. Configure PostgreSQL connection
4. Set up file storage (local or cloud)
5. Configure reverse proxy (Nginx)
6. Enable SSL/TLS
7. Set up monitoring and logging

## Roadmap

- [ ] S3/Cloud storage support
- [ ] WebSocket for real-time updates
- [ ] Image metadata search
- [ ] Batch operations
- [ ] CDN integration
- [ ] Advanced image filters
- [ ] Video support
- [ ] Multi-region storage

## License

MIT

## Support

For issues and questions, please open a GitHub issue.

