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
  Req,
  Logger,
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
import { ClientInterceptor } from '@/client/interceptors/client.interceptor';
import { ClientId, UserId } from '@/client/decorators/client.decorator';
import { Public } from '@/client/decorators/public.decorator';
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

@ApiTags('Images')
@ApiSecurity('api-key')
@Controller('images')
@UseInterceptors(ClientInterceptor)
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(private imageService: ImageService) {}


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
      const result = await this.imageService.uploadImage(
        clientId,
        userId,
        file,
        dto.albumId,
        dto.tags,
        dto.description,
        dto.isPrivate,
      );

      this.logger.log(
        `[Upload] Success - Image ID: ${result.id}, Client: ${clientId}, User: ${userId || 'anonymous'}, Size: ${file.size} bytes`
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
    description: 'Unified endpoint: retrieve image file, thumbnail, metadata, or download. Supports transformations (resize, format, quality). Use ?token for private images or share links. Public for non-private images.',
  })
  @ApiParam({
    name: 'imageId',
    description: 'Image UUID or use with ?token for share link access',
    example: 'b2ce77c1-3836-4e28-807f-51f929e12423',
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
    @Res() res?: Response,
    @Req() req?: import('express').Request,
  ) {
    let image;
    const clientId = req['clientId'];
    const userId = req['userId'];

    this.logger.debug(
      `[GetImage] Starting - ImageId: ${imageId}, Client: ${clientId || 'public'}, User: ${userId || 'anonymous'}, Token: ${query.token ? 'yes' : 'no'}`
    );

    try {
      // If token is provided, try to access via share link first
      if (query.token) {
        this.logger.debug(`[GetImage] Token provided, validating...`);
        try {
          image = await this.imageService.getImageByShareToken(query.token);
          imageId = image.id; // Override imageId with the one from share link
          this.logger.debug(`[GetImage] Token validated - ImageId: ${imageId}`);
        } catch (error) {
          this.logger.debug(`[GetImage] Token validation failed, trying normal access - Error: ${error.message}`);
          // If token validation fails, fall back to normal access with token as auth
          image = await this.imageService.getImageById(imageId);
          await this.imageService.validateImageAccess(image, imageId, clientId, userId, query.token);
        }
      } else {
        this.logger.debug(`[GetImage] No token, fetching image normally...`);
        // Normal access without token
        image = await this.imageService.getImageById(imageId);
        this.logger.debug(`[GetImage] Image fetched - ImageId: ${imageId}`);
        await this.imageService.validateImageAccess(image, imageId, clientId, userId);
        this.logger.debug(`[GetImage] Access validated`);
      }

      // Parse query parameters (now properly transformed by DTO)
      const isInfoRequest = query.info === true;
      const isDownload = query.download === true;
      const isThumb = query.thumb === true;

      this.logger.debug(
        `[GetImage] Request type - Info: ${isInfoRequest}, Download: ${isDownload}, Thumb: ${isThumb}`
      );

      // If info=true, return JSON metadata
      if (isInfoRequest) {
        this.logger.debug(`[GetImage] Returning metadata - ImageId: ${imageId}`);
        const metadata = await this.imageService.getImageMetadata(image);
        this.logger.log(`[GetImage] Metadata - ImageId: ${imageId}, Client: ${image.clientId}`);
        return res.json(metadata);
      }

      // Handle counters
      if (isDownload) {
        this.logger.debug(`[GetImage] Incrementing downloads...`);
        await this.imageService.incrementDownloads(imageId, image.clientId);
        this.logger.debug(`[GetImage] Download count incremented - ImageId: ${imageId}`);
      } else {
        this.logger.debug(`[GetImage] Incrementing views...`);
        await this.imageService.incrementViews(imageId);
        this.logger.debug(`[GetImage] View count incremented - ImageId: ${imageId}`);
      }

      // Get image file
      this.logger.debug(
        `[GetImage] Getting file - ImageId: ${imageId}, Width: ${query.width}, Height: ${query.height}, Format: ${query.format}, Quality: ${query.quality}, Thumb: ${isThumb}`
      );
      const { buffer, mimeType } = await this.imageService.getImageFile(
        imageId,
        isThumb ? undefined : query.width,
        isThumb ? undefined : query.height,
        query.format || 'webp',
        query.quality || 85,
        isThumb,
      );

      this.logger.debug(`[GetImage] File retrieved - Size: ${buffer.length} bytes, MimeType: ${mimeType}`);

      // Set response headers
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${imageId}${isThumb ? '-thumb' : ''}"`,
      };

      if (isDownload) {
        headers['Content-Disposition'] = `attachment; filename="${image.originalName}"`;
      }


      this.logger.debug(`[GetImage] Sending response - ImageId: ${imageId}, MimeType: ${mimeType}, BufferSize: ${buffer.length}`);

      const sendStartTime = Date.now();
      res.set(headers);

      // Log before sending
      this.logger.log(
        `[GetImage] Sending binary - ImageId: ${imageId}, MimeType: ${mimeType}, Size: ${buffer.length} bytes, Client: ${clientId || 'public'}, User: ${userId || 'anonymous'}, Download: ${isDownload}, Thumb: ${isThumb}`
      );

      res.send(buffer);

      // Log after sending (this happens synchronously before response is actually flushed)
      const sendDuration = Date.now() - sendStartTime;
      this.logger.log(
        `[GetImage] Binary sent - ImageId: ${imageId}, Size: ${buffer.length} bytes, Duration: ${sendDuration}ms`
      );
    } catch (error) {
      this.logger.error(
        `[GetImage] Failed - ImageId: ${imageId}, Error: ${error.message}`, error.stack
      );
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
  @ApiOperation({ summary: 'Delete image', description: 'Permanently delete image and files. Only owner can delete.' })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiResponse({ status: 200, description: 'Deleted successfully', type: DeleteResponseDto })
  @ApiResponse({ status: 400, description: 'Missing User ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteImage(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('imageId') imageId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[DeleteImage] Starting - ImageId: ${imageId}, Client: ${clientId}, User: ${userId}`
    );

    const validUserId = this.imageService.validateUserId(userId);

    try {
      const result = await this.imageService.deleteImage(imageId, clientId, validUserId);

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
