# GitHub Copilot Instructions for FileHarbor 2.0

## Project Overview

FileHarbor 2.0 is a multi-tenant image management system built with NestJS 10, Prisma ORM, and PostgreSQL. It provides secure, scalable image storage with automatic optimization, WebP conversion, and on-demand resizing capabilities.

**Key Features:**
- Multi-tenant architecture with API key authentication
- Image management with automatic WebP conversion
- Avatar system with single avatar per user
- Album support (public/private) with token-based access
- Automatic image optimization jobs
- On-demand resizing and format conversion
- Built-in rate limiting and security features

## Tech Stack

- **Framework:** NestJS 10 (Node.js/TypeScript)
- **Database:** PostgreSQL with Prisma ORM
- **Image Processing:** Sharp library
- **Authentication:** JWT tokens, API Keys
- **Package Manager:** pnpm (enforced via preinstall script)
- **Testing:** Jest
- **API Documentation:** Swagger/OpenAPI

## Architecture & Patterns

### Multi-Tenant Structure
All data is scoped by `clientId`. Every request must include:
- `X-API-Key` header (validates and retrieves client - REQUIRED)

User operations require `X-User-Id` header containing the external user ID from the client's system.

**Security Note**: The `X-Client-Id` header is no longer accepted for authentication. Only API Key authentication is supported.

### Module Organization
- **Client Module:** Multi-tenant client management, interceptors, decorators
- **Image Module:** Image upload, retrieval, transformation, metadata
- **Avatar Module:** User avatar management (one per user)
- **Album Module:** Album creation, image organization, token access
- **Storage Module:** File system operations, path management
- **Job Module:** Scheduled optimization tasks (EXIF removal, compression, WebP conversion)
- **Prisma Module:** Database connection and ORM integration

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

## Code Style & Conventions

### TypeScript Configuration
- Target: ES2021
- Module: CommonJS
- Decorators enabled (experimentalDecorators, emitDecoratorMetadata)
- Strict mode partially enabled
- Path alias: `@/*` maps to `src/*`

### NestJS Conventions
1. **Controllers:** Handle HTTP requests, use decorators for routing
2. **Services:** Contain business logic, inject via constructor
3. **DTOs:** Use `class-validator` and `class-transformer` for validation
4. **Modules:** Group related features, declare providers and imports
5. **Interceptors:** Client validation happens in `ClientInterceptor`
6. **Decorators:** Custom decorators like `@CurrentClient()` for extracting context

### Naming Conventions
- Files: kebab-case (e.g., `album.service.ts`)
- Classes: PascalCase (e.g., `AlbumService`)
- Methods: camelCase (e.g., `createAlbum()`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_FILE_SIZE`)
- Database models: PascalCase in Prisma schema

### Code Organization
- DTOs in `dto/` subdirectory within each module
- Decorators in `decorators/` subdirectory
- Interceptors in `interceptors/` subdirectory
- Controllers and services at module root level

## Development Workflow

### Environment Setup
```bash
# Install dependencies (pnpm only)
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with appropriate values

# Generate Prisma client
pnpm run prisma:generate

# Run migrations
pnpm run prisma:migrate

# Seed database (optional)
pnpm run prisma:seed
```

### Running the Application
```bash
# Development with hot reload
pnpm run start:dev

# Production build
pnpm run build
pnpm run start:prod
```

### Testing
```bash
# Run tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Test coverage
pnpm run test:cov

# E2E tests
pnpm run test:e2e
```

### Linting & Formatting
```bash
# Lint code
pnpm run lint

# Format code
pnpm run format
```

## Database Guidelines

### Prisma Workflow
1. Modify `prisma/schema.prisma` for schema changes
2. Run `pnpm run prisma:migrate` to generate migration
3. Prisma Client auto-regenerates after migration
4. Use `pnpm run prisma:studio` to explore database

### Query Patterns
- Always scope queries by `clientId` for multi-tenancy
- Use Prisma's type-safe query builder
- Leverage relations for efficient data loading
- Add indexes for frequently queried fields

### Entities
- **Client:** Top-level tenant with API key
- **User:** User within a client (identified by externalUserId)
- **Image:** Image metadata and storage paths
- **Avatar:** User avatar (one per user)
- **Album:** Image collections with access control
- **AlbumImage:** Many-to-many relation between albums and images
- **AlbumToken:** Temporary access tokens for private albums

## Security Requirements

### Authentication & Authorization
- All endpoints require valid API key or client ID
- User-specific operations require valid User ID
- Private albums require token for non-owner access
- Tokens have configurable expiration

### File Security
- Validate file types (only allowed image formats)
- Enforce file size limits (MAX_FILE_SIZE from env)
- Remove EXIF metadata during optimization
- Sanitize file paths to prevent directory traversal

### Rate Limiting
- Global rate limiting via `@nestjs/throttler`
- Configurable via THROTTLE_TTL and THROTTLE_LIMIT
- Applied to all routes automatically

## Image Processing

### Supported Operations
- Format conversion (JPEG, PNG, WebP, GIF input)
- Automatic WebP conversion for storage
- On-demand resizing (via query parameters)
- Thumbnail generation
- Quality optimization
- EXIF removal

### Sharp Library Usage
- Use Sharp for all image transformations
- Set quality levels from environment variables
- Handle errors gracefully for corrupted images
- Clean up temporary files after processing

## API Design

### Versioning
- API prefix configured via `API_PREFIX` env variable (default: v2)
- Example: `/v2/images/upload`

### Response Patterns
- Success: Return DTO with relevant data
- Error: Use NestJS exception filters
- Validation: Let ValidationPipe handle DTO validation
- Pagination: Include page info when applicable

### Swagger Documentation
- Use decorators: `@ApiTags()`, `@ApiOperation()`, `@ApiResponse()`
- Document all parameters and responses
- Include examples in DTOs
- Keep documentation up-to-date with code changes

## Best Practices for Contributing

### When Adding Features
1. Create new module with `nest g module feature-name`
2. Follow existing module structure
3. Add appropriate DTOs with validation
4. Implement service with business logic
5. Add controller with proper decorators
6. Update Swagger documentation
7. Add tests for new functionality

### When Fixing Bugs
1. Identify the affected module
2. Add or update tests to reproduce the bug
3. Make minimal changes to fix the issue
4. Ensure existing tests still pass
5. Document any behavior changes

### When Refactoring
1. Ensure all tests pass before starting
2. Make incremental changes
3. Run tests frequently during refactoring
4. Maintain backward compatibility where possible
5. Update documentation if interfaces change

## Common Patterns

### Multi-Tenant Queries
```typescript
// Always include clientId in queries
const images = await this.prisma.image.findMany({
  where: {
    clientId: client.id,
    userId: user.id,
  },
});
```

### Error Handling
```typescript
// Use NestJS exceptions
throw new NotFoundException('Image not found');
throw new ForbiddenException('Access denied');
throw new BadRequestException('Invalid file format');
```

### File Operations
```typescript
// Use StorageService for file operations
const filePath = this.storageService.getImagePath(clientId, imageId);
await this.storageService.saveFile(filePath, buffer);
await this.storageService.deleteFile(filePath);
```

### Image Processing
```typescript
// Use Sharp for transformations
const processed = await sharp(buffer)
  .webp({ quality: this.webpQuality })
  .resize(width, height)
  .toBuffer();
```

## Dependencies Management

### Adding Dependencies
- Use `pnpm add <package>` for runtime dependencies
- Use `pnpm add -D <package>` for dev dependencies
- Keep dependencies up-to-date but test thoroughly
- Avoid unnecessary dependencies

### Key Dependencies
- `@nestjs/*`: Framework modules
- `@prisma/client`: Database ORM
- `sharp`: Image processing
- `class-validator`, `class-transformer`: Validation
- `passport`, `passport-jwt`: Authentication
- `uuid`: Unique ID generation
- `multer`: File upload handling

## Scheduled Jobs

### Optimization Job
- Runs hourly (configurable via OPTIMIZATION_JOB_CRON)
- Converts images to WebP
- Removes EXIF metadata
- Compresses images
- Located in Job Module

### Adding New Jobs
1. Create service method with `@Cron()` decorator
2. Use dependency injection for required services
3. Log job execution and errors
4. Handle failures gracefully
5. Configure cron schedule via environment variables

## Testing Strategy

### Unit Tests
- Test services in isolation
- Mock dependencies (Prisma, Storage, etc.)
- Test error conditions
- Aim for high coverage on business logic

### Integration Tests
- Test controller + service interactions
- Use test database for Prisma tests
- Test multi-tenant isolation
- Verify authentication/authorization

### E2E Tests
- Test complete request/response flow
- Test file upload/download
- Verify image transformations
- Test rate limiting

## Documentation

### Code Documentation
- Add JSDoc comments for public methods
- Document complex business logic
- Keep comments up-to-date with code
- Avoid obvious comments

### API Documentation
- Swagger auto-generates from decorators
- Keep DTOs well-documented
- Add examples where helpful
- Document authentication requirements

## Notes for AI Assistants

- Always respect multi-tenant architecture (scope by clientId)
- Use existing patterns and conventions
- Make minimal, surgical changes
- Test changes thoroughly before committing
- Update documentation when changing interfaces
- Use pnpm (not npm or yarn)
- Follow NestJS best practices and idioms
- Maintain backward compatibility unless explicitly changing behavior
- Consider security implications of all changes
- Keep dependencies minimal and up-to-date
