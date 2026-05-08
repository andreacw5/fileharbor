import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUpdateImageDto } from '../dto/admin-update-image.dto';
import { AdminUploadImageDto } from '../dto/admin-upload-image.dto';
import { ImageResponseDto, TinifyCompressionResponseDto } from '@/modules/image/dto';
import {
  AdminDeleteResponseDto,
  AdminImageResponseDto,
} from '../dto/admin-response.dto';
import { ImageService } from '@/modules/image/image.service';
import { plainToInstance } from 'class-transformer';
import { assertClientAccess, buildClientWhere } from '../helpers/admin-access.helper';
import { buildImageTagCreateInput, extractTagNames, normalizeTagNames } from '@/modules/tag/tag.utils';

@ApiTags('Admin - Images')
@Controller('admin/images')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class ImagesAdminController {
  constructor(
    private readonly imageService: ImageService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Upload an image on behalf of a client',
    description: 'Admin-only upload. Specify the target clientId in the form body. Admin JWT replaces the API key.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'clientId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image file' },
        clientId: { type: 'string', format: 'uuid', description: 'Target client ID' },
        externalUserId: { type: 'string', description: 'External user ID (defaults to system)' },
        albumId: { type: 'string', description: 'Album UUID' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Uploaded successfully', type: ImageResponseDto })
  @ApiResponse({ status: 400, description: 'No file or invalid format' })
  @ApiResponse({ status: 403, description: 'Admin has no access to the given client' })
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AdminUploadImageDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<ImageResponseDto> {
    assertClientAccess(adminUser, dto.clientId);
    return this.imageService.uploadImage(
      dto.clientId,
      dto.externalUserId,
      file,
      dto.albumId,
      dto.tags,
      dto.description,
      dto.isPrivate,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List images (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'albumId', required: false })
  @ApiQuery({ name: 'name', required: false, description: 'Search by original filename' })
  @ApiQuery({ name: 'tags', required: false, isArray: true, description: 'Filter by tags' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'size', 'originalName', 'views', 'downloads'], description: 'Sort field' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort order' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listImages(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('albumId') albumId?: string,
    @Query('name') name?: string,
    @Query('tags') tags?: string | string[],
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const tagsArray = tags
      ? Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const pageNum = Number(page) || 1;
    const take = Math.min(Number(perPage) || 20, 100);
    const skip = (pageNum - 1) * take;

    // Validate and set sort parameters
    const allowedSortFields = ['createdAt', 'size', 'originalName', 'views', 'downloads'];
    const validSortBy = sortBy && allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    const where: any = buildClientWhere(adminUser, clientId);
    if (userId) where.user = { id: userId };
    if (albumId) where.albumImages = { some: { albumId } };
    if (name) where.originalName = { contains: name, mode: 'insensitive' };
    if (tagsArray && tagsArray.length > 0) {
      where.imageTags = {
        some: { tag: { name: { in: normalizeTagNames(tagsArray) } } },
      };
    }

    return this.imageService.findAdminImages(
      where,
      { skip, take, page: pageNum },
      { field: validSortBy, order: validSortOrder },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get image details' })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  async getImage(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const image = await this.imageService.findAdminImageById(id);
    if (!image) throw new BadRequestException('Image not found');
    assertClientAccess(adminUser, image.clientId);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    const fullPath = `${baseUrl}/${apiPrefix}/images/${image.id}`;

    const albums = image.albumImages.map((ai) => ai.album);
    const activeShareLinks = image._count.shareLinks;

    return plainToInstance(
      AdminImageResponseDto,
      { ...image, tags: extractTagNames(image), fullPath, albums, activeShareLinks },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update image metadata (originalName, isPrivate, tags, description)' })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  async updateImage(
    @Param('id') id: string,
    @Body() dto: AdminUpdateImageDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const existing = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if ('description' in dto) data.description = dto.description ?? null;
    if (dto.tags !== undefined) {
      const imageTagsInput = buildImageTagCreateInput(existing.clientId, dto.tags);
      data.imageTags = {
        deleteMany: {},
        ...(imageTagsInput.length > 0 && { create: imageTagsInput }),
      };
    }

    const updated = await this.imageService.adminUpdateImage(id, data);
    return plainToInstance(
      AdminImageResponseDto,
      { ...updated, tags: extractTagNames(updated) },
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete an image (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  async deleteImage(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const image = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, image.clientId);

    await this.imageService.deleteImage(id, image.clientId);

    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Image deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  @Post(':id/tinify-compress')
  @ApiOperation({
    summary: 'Compress image with Tinify (TinyPNG)',
    description: 'Sends the existing image to Tinify API for additional compression, replaces the original, and regenerates the thumbnail. Returns compression statistics along with the updated image. Requires the client to have Tinify enabled (tinifyActive=true) and a valid API key configured. The compression limit is configurable per client (default: 500/month for free tier).',
  })
  @ApiResponse({ status: 200, description: 'Image compressed successfully with compression stats', type: TinifyCompressionResponseDto })
  @ApiResponse({ status: 400, description: 'Tinify not enabled, API key not configured, monthly limit reached, or image already compressed with Tinify' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Image or client not found' })
  async compressImageWithTinify(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<TinifyCompressionResponseDto> {
    const image = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, image.clientId);

    return this.imageService.compressImageWithTinify(id);
  }
}

