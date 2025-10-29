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
@ApiSecurity('client-id')
@Controller('images')
@UseInterceptors(ClientInterceptor)
export class ImageController {
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
        albumId: { type: 'string', description: 'Album UUID', example: 'album-uuid' },
        tags: { type: 'array', items: { type: 'string' }, example: ['nature', 'landscape'] },
        description: { type: 'string', example: 'Beautiful sunset' },
        isPrivate: { type: 'boolean', default: false },
        clientId: { type: 'string', description: 'Fallback client ID' },
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
    @Query() dto: UploadImageDto,
    @Req() req: import('express').Request,
  ): Promise<ImageResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }


    // If clientId is missing, try to get it from query/body, else fallback to 'system'
    let resolvedClientId = clientId;
    if (!resolvedClientId) {
      resolvedClientId = (req.query.clientId as string) || (req.body && req.body.clientId) || 'system';
    }

    return this.imageService.uploadImage(
      resolvedClientId,
      userId,
      file,
      dto.albumId,
      dto.tags,
      dto.description,
      dto.isPrivate,
    );
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

    return this.imageService.listImages(filters);
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

    // If token is provided, try to access via share link first
    if (query.token) {
      try {
        image = await this.imageService.getImageByShareToken(query.token);
        imageId = image.id; // Override imageId with the one from share link
      } catch (error) {
        // If token validation fails, fall back to normal access with token as auth
        image = await this.imageService.getImageById(imageId);
        await this.imageService.validateImageAccess(image, imageId, clientId, userId, query.token);
      }
    } else {
      // Normal access without token
      image = await this.imageService.getImageById(imageId);
      await this.imageService.validateImageAccess(image, imageId, clientId, userId);
    }

    // Parse query parameters (now properly transformed by DTO)
    const isInfoRequest = query.info === true;
    const isDownload = query.download === true;
    const isThumb = query.thumb === true;

    // If info=true, return JSON metadata
    if (isInfoRequest) {
      const metadata = await this.imageService.getImageMetadata(image);
      return res.json(metadata);
    }

    // Handle counters
    if (isDownload) {
      await this.imageService.incrementDownloads(imageId, image.clientId);
    } else {
      await this.imageService.incrementViews(imageId);
    }

    // Get image file
    const { buffer, mimeType } = await this.imageService.getImageFile(
      imageId,
      isThumb ? undefined : query.width,
      isThumb ? undefined : query.height,
      query.format || 'webp',
      query.quality || 85,
      isThumb,
    );

    // Set response headers
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': `"${imageId}${isThumb ? '-thumb' : ''}"`,
    };

    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${image.originalName}"`;
    }

    res.set(headers);
    res.send(buffer);
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
    const validUserId = this.imageService.validateUserId(userId);

    return this.imageService.updateImageMetadata(
      imageId,
      clientId,
      validUserId,
      dto.tags,
      dto.description,
    );
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
    const validUserId = this.imageService.validateUserId(userId);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;

    return this.imageService.createShareLink(imageId, clientId, validUserId, expiresAt);
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
    const validUserId = this.imageService.validateUserId(userId);

    return this.imageService.deleteShareLink(shareId, clientId, validUserId);
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
    const validUserId = this.imageService.validateUserId(userId);

    return this.imageService.deleteImage(imageId, clientId, validUserId);
  }
}
