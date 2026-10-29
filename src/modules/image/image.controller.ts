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
  Logger,
  StreamableFile,
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
import { ConfigService } from '@nestjs/config';
import { ImageService } from './image.service';
import {
  IMAGE_UPLOAD_LIMITS,
  StorageService,
} from '@/modules/storage/storage.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import { BastionAuditService, Public } from '@heyatom/bastion-client/nest';
import { auditClientWrite } from '@/common/client-audit';
import { SkipThrottle } from '@nestjs/throttler';
import {
  UploadImageDto,
  GetImageDto,
  ImageResponseDto,
  UpdateImageMetadataDto,
  CreateShareLinkDto,
  ShareLinkResponseDto,
  ListImagesDto,
  DeleteResponseDto,
} from './dto';
import { Readable } from 'node:stream';
import { contentDisposition } from '@/utils/content-disposition';
import { snapQuality, snapSize } from './image-variants';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  NoTransform,
  PaginatedResult,
} from '@heyatom/nest-common';

@ApiTags('Images')
@ApiSecurity('api-key')
@Controller('images')
@UseInterceptors(ClientInterceptor)
export class ImageController {
  private readonly logger = new Logger(ImageController.name);

  constructor(
    private imageService: ImageService,
    private storageService: StorageService,
    private config: ConfigService,
    private audit: BastionAuditService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Upload image',
    description:
      'Upload new image (JPEG, PNG, WebP, GIF). Auto-converts to WebP and optimizes. Optional album and privacy.',
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
        blurPublic: {
          type: 'boolean',
          default: false,
          description:
            'Serve the ?blur=1 preview to anyone, even when the image is private',
        },
        username: {
          type: 'string',
          description:
            'Username of the uploader (saved/updated on the creator record)',
        },
      },
    },
  })
  @ApiCreatedData(ImageResponseDto, 'Uploaded successfully')
  @ApiResponse({ status: 400, description: 'No file or invalid format' })
  @ApiResponse({ status: 413, description: 'File too large' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { ...IMAGE_UPLOAD_LIMITS, files: 1 } }),
  )
  async uploadImage(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImageDto,
  ): Promise<ImageResponseDto> {
    if (!file) {
      this.logger.warn(`[Upload] No file provided by client ${clientId}`);
      throw new BadRequestException('No file uploaded');
    }

    this.logger.debug(
      `[Upload] Starting - Client: ${clientId}, Creator: ${creatorId || 'anonymous'}, File: ${file.originalname} (${file.size} bytes), MIME: ${file.mimetype}`,
    );

    try {
      // Use creatorId from DTO if provided, otherwise use from decorator (X-User-Id header)
      const effectiveCreatorExternalId = dto.creatorId || creatorId;
      this.logger.debug(
        `[Upload] Effective Creator ID: ${effectiveCreatorExternalId || 'system'}`,
      );

      const result = await this.imageService.uploadImage(
        clientId,
        effectiveCreatorExternalId,
        file,
        dto.albumId,
        dto.tags,
        dto.description,
        dto.isPrivate,
        dto.username,
        dto.blurPublic,
      );

      this.logger.log(
        `[Upload] Success - Image ID: ${result.id}, Client: ${clientId}, Creator: ${effectiveCreatorExternalId || 'system'}, Size: ${file.size} bytes`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[Upload] Failed - Client: ${clientId}, File: ${file.originalname}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List images',
    description: 'Paginated list of images with optional creator filter.',
  })
  @ApiPaginatedResponse(ImageResponseDto)
  async listImages(
    @ClientId() clientId: string,
    @Query() query: ListImagesDto,
  ): Promise<PaginatedResult<ImageResponseDto>> {
    this.logger.debug(
      `[ListImages] Client: ${clientId}, Creator: ${query.creatorId || 'all'}, Album: ${query.albumId || 'all'}, Page: ${query.page}, Limit: ${query.limit}`,
    );

    // Always use the authenticated client's ID
    const result = await this.imageService.listImages(
      { clientId, creatorId: query.creatorId, albumId: query.albumId },
      query,
    );

    this.logger.log(
      `[ListImages] Success - Client: ${clientId}, Total: ${result.meta.total}, Returned: ${result.data.length}`,
    );

    return result;
  }

  @Public()
  // Media delivery: one page can embed dozens of these.
  @SkipThrottle()
  // Serves files; the ?info JSON is wrapped below so clients still read .data
  @NoTransform()
  @Get(':imageId')
  @ApiOperation({
    summary: 'Get image',
    description:
      'Unified endpoint: retrieve image file, thumbnail, metadata, or download. Supports transformations (resize, format, quality). Use ?token for private images or share links. Use ?t for cache busting. Public for non-private images.',
  })
  @ApiResponse({
    status: 200,
    description: 'Image file or metadata returned',
    content: {
      'image/webp': {},
      'image/jpeg': {},
      'image/png': {},
      // ?info=true: the one JSON branch, enveloped by hand (@NoTransform)
      'application/json': {
        schema: {
          properties: {
            data: { $ref: '#/components/schemas/ImageResponseDto' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Authentication or valid token required',
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  async getImage(
    @Param('imageId') imageId: string,
    @Query() query: GetImageDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: import('express').Request,
  ) {
    const clientId = req['clientId'];
    const creatorId = req['externalCreatorId'];
    // The blurred preview (plan 11): info and download win over it, and it wins
    // over every transform but format.
    const blur = !!query.blur && !query.info && !query.download;
    const requestType = query.info
      ? 'metadata'
      : query.download
        ? 'download'
        : blur
          ? 'blur'
          : query.thumb
            ? 'thumb'
            : 'view';

    // Single comprehensive log for request start
    this.logger.debug(
      `[GetImage] ${requestType} | ${imageId} | client:${clientId || 'public'} | creator:${creatorId || 'anon'} | token:${!!query.token}`,
    );

    try {
      let image;
      let viaShareLink = false;
      if (query.token) {
        try {
          // Try share link first
          image = await this.imageService.getImageByShareToken(query.token);
          imageId = image.id;
          viaShareLink = true;
        } catch {
          // Fallback to normal access with token validation
          image = await this.imageService.getImageById(
            imageId,
            undefined,
            !!query.info,
          );
        }
      } else {
        image = await this.imageService.getImageById(
          imageId,
          undefined,
          !!query.info,
        );
      }
      // blurPublic opens the blurred preview to anyone. Safe without a check:
      // the blur branch of getImageFile never falls back to the original.
      if (!viaShareLink && !(blur && image.blurPublic))
        await this.imageService.validateImageAccess(
          image,
          imageId,
          clientId,
          creatorId,
          query.token,
        );

      // Handle metadata request early return
      if (query.info) {
        const metadata = await this.imageService.getImageMetadata(image);
        this.logger.log(`[GetImage] metadata | ${imageId} | ${image.clientId}`);
        return { data: metadata };
      }

      // Counters: views are buffered in memory, downloads are one UPDATE.
      // Counted only once the bytes are served (or a 304 confirms them), so a
      // 503 from a full render queue is not a view.
      // The blurred preview is not a view, 304 included.
      const countHit = async () => {
        if (blur) return;
        await (query.download
          ? this.imageService.incrementDownloads(imageId, image.clientId)
          : this.imageService.incrementViews(imageId));
      };

      // Set response headers
      // Private bytes and token-gated responses must never land in a shared
      // cache (CDN, proxy): the next requester would get them without a check.
      // A public blurred preview is the same for everyone and safe to cache.
      const restricted =
        !(blur && image.blurPublic) && (image.isPrivate || !!query.token);
      const variant = blur
        ? query.format && query.format !== 'webp'
          ? `blur-${query.format}`
          : 'blur'
        : query.thumb
          ? 'thumb'
          : [
              // Snapped like getImageFile does: URLs that render the same
              // variant share one ETag.
              snapSize(query.width) ?? '',
              snapSize(query.height) ?? '',
              query.format || 'webp',
              snapQuality(query.quality),
            ].join('-');
      // updatedAt moves when the file is rewritten (optimize job, Tinify, admin
      // regenerate), never on a view or download (those counters skip it), so revalidation stays cheap.
      const etag = `"${imageId}-${variant}-${image.updatedAt.getTime()}"`;
      const headers: Record<string, string> = {
        'Cache-Control': restricted
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
        ETag: etag,
      };

      if (query.download) {
        headers['Content-Disposition'] = contentDisposition(image.originalName);
      }

      // Access was checked above, so a matching ETag can skip the file entirely
      const ifNoneMatch = req?.headers['if-none-match'];
      if (
        ifNoneMatch &&
        ifNoneMatch
          .split(',')
          .some(
            (t) => t.trim().replace(/^W\//, '') === etag || t.trim() === '*',
          )
      ) {
        await countHit();
        res.status(304).set(headers);
        return;
      }

      // Behind nginx, hand files already on disk to it instead of streaming
      // them from Node (see IMAGE_X_ACCEL_REDIRECT)
      const xAccel = this.config.get<boolean>('image.xAccelRedirect');
      const { buffer, mimeType, filePath } =
        await this.imageService.getImageFile(image, {
          width: query.thumb ? undefined : query.width,
          height: query.thumb ? undefined : query.height,
          format: query.format || 'webp',
          quality: query.quality,
          thumb: query.thumb,
          blur,
          skipDiskRead: xAccel,
        });
      await countHit();
      headers['Content-Type'] = mimeType;
      res.set(headers);

      if (!buffer) {
        res.set(
          'X-Accel-Redirect',
          `/internal-images/${this.storageService.toStorageRelative(filePath!)}`,
        );
        this.logger.log(
          `[GetImage] ${requestType} | ${imageId} | ${mimeType} | x-accel | client:${clientId || 'public'}`,
        );
        return;
      }

      this.logger.log(
        `[GetImage] ${requestType} | ${imageId} | ${mimeType} | ${Math.round(buffer.length / 1024)}KB | client:${clientId || 'public'}`,
      );

      return new StreamableFile(Readable.from(buffer), {
        type: mimeType,
        length: buffer.length,
      });
    } catch (error) {
      // Return default images for 404 and 403 errors (only for file requests, not metadata)
      if (
        !query.info &&
        (error instanceof NotFoundException ||
          error instanceof ForbiddenException)
      ) {
        const defaultType =
          error instanceof NotFoundException
            ? 'not_found'
            : 'permission_denied';

        this.logger.warn(
          `[GetImage] ${defaultType.toUpperCase()} | ${imageId} | Returning default image | ${error.message}`,
        );

        try {
          const buffer = await this.storageService.getDefaultImage(defaultType);
          const mimeType = 'image/webp';

          res.set({
            'Content-Type': mimeType,
            // A denial depends on who asks: don't let a cache replay it to the owner.
            'Cache-Control':
              defaultType === 'permission_denied'
                ? 'private, no-store'
                : 'public, max-age=3600',
            'X-FileHarbor-Fallback': defaultType,
          });

          return new StreamableFile(Readable.from(buffer), {
            type: mimeType,
            length: buffer.length,
          });
        } catch (defaultError) {
          this.logger.error(
            `[GetImage] FAILED to load default image | ${defaultType} | ${defaultError.message}`,
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
    description:
      'Update tags, description, isPrivate or blurPublic. Only the owner (X-User-Id) can update.',
  })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiOkData(ImageResponseDto, 'Updated successfully')
  @ApiResponse({
    status: 400,
    description: 'Invalid data or missing Creator ID',
  })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateImage(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateImageMetadataDto,
  ): Promise<ImageResponseDto> {
    this.logger.debug(
      `[UpdateImage] Starting - ImageId: ${imageId}, Client: ${clientId}, Creator: ${creatorId}`,
    );

    const validCreatorExternalId =
      this.imageService.validateCreatorExternalId(creatorId);

    try {
      const result = await this.imageService.updateImageMetadata(
        imageId,
        clientId,
        validCreatorExternalId,
        dto.tags,
        dto.description,
        dto.isPrivate,
        dto.blurPublic,
      );
      // Visibility changes only; the booleans are the fact tracked, not secrets.
      const visibility = {
        ...(typeof dto.isPrivate === 'boolean' && { isPrivate: dto.isPrivate }),
        ...(typeof dto.blurPublic === 'boolean' && {
          blurPublic: dto.blurPublic,
        }),
      };
      if (Object.keys(visibility).length > 0)
        auditClientWrite(this.audit, 'fh_image.updated', clientId, creatorId, {
          imageId,
          fields: Object.keys(visibility),
          ...visibility,
        });

      this.logger.log(
        `[UpdateImage] Success - ImageId: ${imageId}, Client: ${clientId}, Creator: ${creatorId}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[UpdateImage] Failed - ImageId: ${imageId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Post(':imageId/share')
  @ApiOperation({
    summary: 'Create share link',
    description:
      'Generate shareable link with optional expiration. Only owner can create.',
  })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiCreatedData(ShareLinkResponseDto, 'Share link created')
  @ApiResponse({ status: 400, description: 'Missing Creator ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async createShareLink(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('imageId') imageId: string,
    @Body() dto: CreateShareLinkDto,
  ): Promise<ShareLinkResponseDto> {
    this.logger.debug(
      `[CreateShareLink] Starting - ImageId: ${imageId}, Client: ${clientId}, Creator: ${creatorId}`,
    );

    const validCreatorExternalId =
      this.imageService.validateCreatorExternalId(creatorId);
    const expiresAt = dto.expiresAt;

    try {
      const result = await this.imageService.createShareLink(
        imageId,
        clientId,
        validCreatorExternalId,
        expiresAt,
      );

      this.logger.log(
        `[CreateShareLink] Success - ImageId: ${imageId}, Expires: ${expiresAt ? expiresAt.toISOString() : 'never'}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[CreateShareLink] Failed - ImageId: ${imageId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Delete('share/:shareId')
  @ApiOperation({
    summary: 'Revoke share link',
    description: 'Delete/revoke share link. Only owner can revoke.',
  })
  @ApiParam({ name: 'shareId', description: 'Share link UUID' })
  @ApiOkData(DeleteResponseDto, 'Revoked successfully')
  @ApiResponse({ status: 400, description: 'Missing Creator ID' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteShareLink(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('shareId') shareId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[DeleteShareLink] Starting - ShareId: ${shareId}, Client: ${clientId}, Creator: ${creatorId}`,
    );

    const validCreatorExternalId =
      this.imageService.validateCreatorExternalId(creatorId);

    try {
      const result = await this.imageService.deleteShareLink(
        shareId,
        clientId,
        validCreatorExternalId,
      );

      this.logger.log(`[DeleteShareLink] Success - ShareId: ${shareId}`);

      return result;
    } catch (error) {
      this.logger.error(
        `[DeleteShareLink] Failed - ShareId: ${shareId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Delete(':imageId')
  @ApiOperation({
    summary: 'Delete image',
    description: 'Permanently delete image and files.',
  })
  @ApiParam({ name: 'imageId', description: 'Image UUID' })
  @ApiOkData(DeleteResponseDto, 'Deleted successfully')
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteImage(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string | undefined,
    @Param('imageId') imageId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[DeleteImage] Starting - ImageId: ${imageId}, Client: ${clientId}`,
    );

    try {
      const result = await this.imageService.deleteImage(imageId, clientId);
      auditClientWrite(this.audit, 'fh_image.deleted', clientId, creatorId, {
        imageId,
      });

      this.logger.log(`[DeleteImage] Success - ImageId: ${imageId}`);

      return result;
    } catch (error) {
      this.logger.error(
        `[DeleteImage] Failed - ImageId: ${imageId}, Error: ${error.message}`,
      );
      throw error;
    }
  }
}
