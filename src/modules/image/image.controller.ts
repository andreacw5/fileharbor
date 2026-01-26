import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Patch,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Req,
  Logger, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiSecurity,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ImageService } from './image.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { ClientId, UserId } from '@/modules/client/decorators/client.decorator';
import { Public } from '@/modules/client/decorators/public.decorator';
import {
  UploadImageDto,
  GetImageDto,
  ImageResponseDto,
  UpdateImageMetadataDto,
  CreateShareLinkDto,
  ShareLinkResponseDto,
  ListImagesDto,
  DeleteResponseDto,
  ListImagesResponseDto,
} from './dto';
import { Readable } from 'node:stream';

@ApiTags('Images')
@ApiSecurity('api-key')
@Controller('images')
@UseInterceptors(ClientInterceptor)
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(
    private imageService: ImageService,
    private storageService: StorageService,
  ) {}


  @Post()
  @ApiOperation({
    summary: 'Upload image',
    description: 'Upload new image (JPEG, PNG, WebP, GIF). Auto-converts to WebP and optimizes. Optional album and privacy.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image file' },
        albumId: { type: 'string', description: 'Album UUID' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Uploaded successfully', type: ImageResponseDto })
  @ApiResponse({ status: 400, description: 'No file or invalid format' })
  @ApiResponse({ status: 413, description: 'File too large' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @ClientId() clientId: string,
    @UserId() userId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImageDto,
  ): Promise<ImageResponseDto> {
    if (!file) {
      this.logger.warn(`[Upload] No file provided by client ${clientId}`);
      throw new BadRequestException('No file uploaded');
    }

    this.logger.debug(
      `[Upload] Starting - Client: ${clientId}, User: ${userId || 'anonymous'}, File: ${file.originalname} (${file.size} bytes), MIME: ${file.mimetype}`
    );

    try {
      // Use userId from DTO if provided, otherwise use from decorator (X-User-Id header)
      const effectiveUserId = dto.userId || userId;
      this.logger.debug(
        `[Upload] Effective User ID: ${effectiveUserId || 'system'}`
      );

      const result = await this.imageService.uploadImage(
        clientId,
        effectiveUserId,
        file,
        dto.albumId,
        dto.tags,
        dto.description,
        dto.isPrivate,
      );

      this.logger.log(
        `[Upload] Success - Image ID: ${result.id}, Client: ${clientId}, User: ${effectiveUserId || 'system'}, Size: ${file.size} bytes`
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[Upload] Failed - Client: ${clientId}, File: ${file.originalname}, Error: ${error.message}`
      );
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List images',
    description: 'Paginated list of images with optional user filter.',
  })
  @ApiResponse({
    status: 200,
    description: 'Retrieved successfully',
    type: ListImagesResponseDto,
  })
  async listImages(
    @ClientId() clientId: string,
    @Query() query: ListImagesDto,
  ): Promise<ListImagesResponseDto> {
    // Always use the authenticated client's ID
    const filters = {
      clientId: clientId,
      userId: query.userId,
      page: query.page,
      perPage: query.perPage,
    };

    this.logger.debug(
      `[ListImages] Client: ${clientId}, User: ${query.userId || 'all'}, Page: ${query.page || 1}, PerPage: ${query.perPage || 20}`
    );

    const result = await this.imageService.listImages(filters);

    this.logger.log(
      `[ListImages] Success - Client: ${clientId}, Total: ${result.pagination.total}, Returned: ${result.data.length}`
    );

    return result;
  }

  @Public()
  @Get(':imageId')
  @ApiOperation({
    summary: 'Get image',
    description: 'Unified endpoint: retrieve image file, thumbnail, metadata, or download. Supports transformations (resize, format, quality). Use ?token for private images or share links. Use ?t for cache busting. Public for non-private images.',
  })
  @ApiResponse({
    status: 200,
    description: 'Image file or metadata returned',
    content: {
      'image/webp': {},
      'image/jpeg': {},
      'image/png': {},
      'application/json': { schema: { $ref: '#/components/schemas/ImageResponseDto' } },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Authentication or valid token required' })
  @ApiResponse({ status: 404, description: 'Image not found' })
  async getImage(
    @Param('imageId') imageId: string,
    @Query() query: GetImageDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: import('express').Request,
  ) {
    const clientId = req['clientId'];
    const userId = req['userId'];
    const requestType = query.info ? 'metadata' : query.download ? 'download' : query.thumb ? 'thumb' : 'view';

    // Single comprehensive log for request start
    this.logger.debug(
      `[GetImage] ${requestType} | ${imageId} | client:${clientId || 'public'} | user:${userId || 'anon'} | token:${!!query.token}`
    );

    try {
      // Handle image access with optimized logic
      let image;
      if (query.token) {
        try {
          // Try share link first
          image = await this.imageService.getImageByShareToken(query.token);
          imageId = image.id;
        } catch {
          // Fallback to normal access with token validation
          image = await this.imageService.getImageById(imageId);
          await this.imageService.validateImageAccess(image, imageId, clientId, userId, query.token);
        }
      } else {
        image = await this.imageService.getImageById(imageId);
        await this.imageService.validateImageAccess(image, imageId, clientId, userId);
      }

      // Handle metadata request early return
      if (query.info) {
        const metadata = await this.imageService.getImageMetadata(image);
        this.logger.log(`[GetImage] metadata | ${imageId} | ${image.clientId}`);
        return metadata;
      }

      // Update counters (fire and forget for performance) - create promises without await
      const counterPromise = query.download
        ? this.imageService.incrementDownloads(imageId, image.clientId)
        : this.imageService.incrementViews(imageId);

      // Get image file
      const filePromise = this.imageService.getImageFile(
        imageId,
        query.thumb ? undefined : query.width,
        query.thumb ? undefined : query.height,
        query.format || 'webp',
        query.quality || 85,
        query.thumb,
      );

      // Wait for both file and counter update
      const [{ buffer, mimeType }] = await Promise.all([filePromise, counterPromise]);

      // Set response headers
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${imageId}${query.thumb ? '-thumb' : ''}"`,
      };

      if (query.download) {
        headers['Content-Disposition'] = `attachment; filename="${image.originalName}"`;
      }

      res.set(headers);

      this.logger.log(
        `[GetImage] ${requestType} | ${imageId} | ${mimeType} | ${Math.round(buffer.length / 1024)}KB | client:${clientId || 'public'}`
      );

      return new StreamableFile(Readable.from(buffer), {
        type: mimeType,
        length: buffer.length,
      });

    } catch (error) {
      // Return default images for 404 and 403 errors (only for file requests, not metadata)
      if (!query.info && (error instanceof NotFoundException || error instanceof ForbiddenException)) {
        const defaultType = error instanceof NotFoundException ? 'not_found' : 'permission_denied';

        this.logger.warn(
          `[GetImage] ${defaultType.toUpperCase()} | ${imageId} | Returning default image | ${error.message}`
        );

        try {
          const buffer = await this.storageService.getDefaultImage(defaultType);
          const mimeType = 'image/webp';

          res.set({
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=3600',
            'X-FileHarbor-Fallback': defaultType,
          });

          return new StreamableFile(Readable.from(buffer), {
            type: mimeType,
            length: buffer.length,
          });
        } catch (defaultError) {
          this.logger.error(
            `[GetImage] FAILED to load default image | ${defaultType} | ${defaultError.message}`
          );
          // If default image fails, throw the original error
          throw error;
        }
      }

      this.logger.error(`[GetImage] FAILED | ${imageId} | ${error.message}`);
      throw error;
    }
  }

  @Patch(':imageId')
  @ApiOperation({
    summary: 'Update image metadata',
    description: 'Update tags, description, or other metadata. Only owner can update.',
  })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiResponse({ status: 200, description: 'Updated successfully', type: ImageResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid data or missing User ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateImage(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateImageMetadataDto,
  ): Promise<ImageResponseDto> {
    this.logger.debug(
      `[UpdateImage] Starting - ImageId: ${imageId}, Client: ${clientId}, User: ${userId}`
    );

    const validUserId = this.imageService.validateUserId(userId);

    try {
      const result = await this.imageService.updateImageMetadata(
        imageId,
        clientId,
        validUserId,
        dto.tags,
        dto.description,
      );

      this.logger.log(
        `[UpdateImage] Success - ImageId: ${imageId}, Client: ${clientId}, User: ${userId}`
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[UpdateImage] Failed - ImageId: ${imageId}, Error: ${error.message}`
      );
      throw error;
    }
  }


  @Post(':imageId/share')
  @ApiOperation({
    summary: 'Create share link',
    description: 'Generate shareable link with optional expiration. Only owner can create.',
  })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiResponse({ status: 201, description: 'Share link created', type: ShareLinkResponseDto })
  @ApiResponse({ status: 400, description: 'Missing User ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async createShareLink(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('imageId') imageId: string,
    @Body() dto: CreateShareLinkDto,
  ): Promise<ShareLinkResponseDto> {
    this.logger.debug(
      `[CreateShareLink] Starting - ImageId: ${imageId}, Client: ${clientId}, User: ${userId}`
    );

    const validUserId = this.imageService.validateUserId(userId);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;

    try {
      const result = await this.imageService.createShareLink(imageId, clientId, validUserId, expiresAt);

      this.logger.log(
        `[CreateShareLink] Success - ImageId: ${imageId}, Expires: ${expiresAt ? expiresAt.toISOString() : 'never'}`
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[CreateShareLink] Failed - ImageId: ${imageId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  @Delete('share/:shareId')
  @ApiOperation({ summary: 'Revoke share link', description: 'Delete/revoke share link. Only owner can revoke.' })
  @ApiParam({ name: 'shareId', description: 'Share link UUID' })
  @ApiResponse({ status: 200, description: 'Revoked successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 400, description: 'Missing User ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteShareLink(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('shareId') shareId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[DeleteShareLink] Starting - ShareId: ${shareId}, Client: ${clientId}, User: ${userId}`
    );

    const validUserId = this.imageService.validateUserId(userId);

    try {
      const result = await this.imageService.deleteShareLink(shareId, clientId, validUserId);

      this.logger.log(`[DeleteShareLink] Success - ShareId: ${shareId}`);

      return result;
    } catch (error) {
      this.logger.error(
        `[DeleteShareLink] Failed - ShareId: ${shareId}, Error: ${error.message}`
      );
      throw error;
    }
  }


  @Delete(':imageId')
  @ApiOperation({ summary: 'Delete image', description: 'Permanently delete image and files.' })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiResponse({ status: 200, description: 'Deleted successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteImage(
    @ClientId() clientId: string,
    @Param('imageId') imageId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[DeleteImage] Starting - ImageId: ${imageId}, Client: ${clientId}`
    );

    try {
      const result = await this.imageService.deleteImage(imageId, clientId);

      this.logger.log(`[DeleteImage] Success - ImageId: ${imageId}`);

      return result;
    } catch (error) {
      this.logger.error(
        `[DeleteImage] Failed - ImageId: ${imageId}, Error: ${error.message}`
      );
      throw error;
    }
  }
}
