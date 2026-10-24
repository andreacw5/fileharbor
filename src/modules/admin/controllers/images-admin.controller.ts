import { SkipThrottle } from '@nestjs/throttler';
import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  StreamableFile,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'stream';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { AdminUpdateImageDto } from '../dto/admin-update-image.dto';
import { AdminUploadImageDto } from '../dto/admin-upload-image.dto';
import { AdminBulkDeleteDto } from '../dto/admin-bulk-delete.dto';
import {
  ImageResponseDto,
  TinifyCompressionResponseDto,
} from '@/modules/image/dto';
import {
  AdminBulkDeleteResponseDto,
  AdminDeleteResponseDto,
  AdminImageResponseDto,
  AdminImageListResponseDto,
} from '../dto/admin-response.dto';
import { ImageService } from '@/modules/image/image.service';
import { plainToInstance } from 'class-transformer';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import { parseBooleanQuery } from '../helpers/admin-query.helper';
import {
  AdminDuplicateGroupDto,
  AdminDuplicateListQuery,
} from '../dto/admin-duplicates.dto';
import { ApiPaginatedResponse, PaginatedResult } from '@heyatom/nest-common';
import { DHASH_PATTERN } from '@/modules/storage/storage.service';
import { DuplicateGroup } from '@/modules/image/image.service';
import {
  buildImageTagCreateInput,
  extractTagNames,
  normalizeTagNames,
} from '@/modules/tag/tag.utils';
import { RouteHelperService } from '@/utils/route.utils';
import { IMAGE_UPLOAD_LIMITS } from '@/modules/storage/storage.service';
import { contentDisposition } from '@/utils/content-disposition';

@ApiTags('Admin - Images')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/images')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-media.manage')
export class ImagesAdminController {
  constructor(
    private readonly imageService: ImageService,
    private readonly route: RouteHelperService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Upload one or more images on behalf of a client',
    description:
      'Admin-only upload. Specify the target clientId in the form body. Admin JWT replaces the API key. All uploaded files share the same metadata (tags, description, isPrivate, etc.).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files', 'clientId'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'One or more image files',
        },
        clientId: {
          type: 'string',
          format: 'uuid',
          description: 'Target client ID',
        },
        externalId: {
          type: 'string',
          description: 'External creator ID (defaults to system)',
        },
        albumId: { type: 'string', description: 'Album UUID' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Uploaded successfully',
    type: [ImageResponseDto],
  })
  @ApiResponse({ status: 400, description: 'No file or invalid format' })
  @ApiResponse({
    status: 403,
    description: 'Admin has no access to the given client',
  })
  @UseInterceptors(
    FilesInterceptor('files', IMAGE_UPLOAD_LIMITS.files, {
      limits: IMAGE_UPLOAD_LIMITS,
    }),
  )
  @Audit('fh_image.uploaded', {
    metadata: (r: ImageResponseDto[], req: AuditRequest) => ({
      clientId: (req.body as { clientId?: string })?.clientId,
      count: Array.isArray(r) ? r.length : 0,
      imageIds: Array.isArray(r) ? r.map((image) => image.id) : [],
    }),
  })
  async uploadImage(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: AdminUploadImageDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<ImageResponseDto[]> {
    assertClientAccess(adminUser, dto.clientId);

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file must be provided');
    }

    const results: ImageResponseDto[] = [];
    for (const file of files) {
      const result = await this.imageService.uploadImage(
        dto.clientId,
        dto.externalId,
        file,
        dto.albumId,
        dto.tags,
        dto.description,
        dto.isPrivate,
      );
      results.push(result);
    }
    return results;
  }

  @Get()
  @ApiOperation({ summary: 'List images (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'creatorId', required: false })
  @ApiQuery({ name: 'albumId', required: false })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Search by original filename',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    isArray: true,
    description: 'Filter by tags',
  })
  @ApiQuery({
    name: 'isPrivate',
    required: false,
    enum: ['true', 'false'],
    description: 'Only private (true) or only public (false) files',
  })
  @ApiQuery({
    name: 'dHash',
    required: false,
    description: 'Only images with this dHash (16 hex chars)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'size', 'originalName', 'views', 'downloads'],
    description: 'Sort field',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Sort order',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminImageListResponseDto })
  async listImages(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('creatorId') creatorId?: string,
    @Query('albumId') albumId?: string,
    @Query('name') name?: string,
    @Query('tags') tags?: string | string[],
    @Query('isPrivate') isPrivate?: string,
    @Query('dHash') dHash?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const tagsArray = tags
      ? Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
      : undefined;

    const pageNum = Number(page) || 1;
    const take = Math.min(Number(perPage) || 20, 100);
    const skip = (pageNum - 1) * take;

    // Validate and set sort parameters
    const allowedSortFields = [
      'createdAt',
      'size',
      'originalName',
      'views',
      'downloads',
    ];
    const validSortBy =
      sortBy && allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const validSortOrder =
      sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    const where: any = buildClientWhere(adminUser, clientId);
    if (creatorId) where.creator = { id: creatorId };
    if (albumId)
      where.albumItems = { some: { albumId, resourceType: 'IMAGE' } };
    if (name) where.originalName = { contains: name, mode: 'insensitive' };
    const privacy = parseBooleanQuery('isPrivate', isPrivate);
    if (privacy !== undefined) where.isPrivate = privacy;
    if (dHash !== undefined && dHash !== '') {
      if (!DHASH_PATTERN.test(dHash)) {
        throw new BadRequestException('dHash must be 16 hex characters');
      }
      where.dHash = dHash;
    }
    if (tagsArray && tagsArray.length > 0) {
      where.imageTags = {
        some: { tag: { name: { in: normalizeTagNames(tagsArray) } } },
      };
    }

    return this.imageService.findAdminImages(
      where,
      { skip, take, page: pageNum },
      { field: validSortBy, order: validSortOrder },
      adminUser.actorId,
    );
  }

  // Before @Get(':id'), or 'duplicates' would be taken for an id.
  @Get('duplicates')
  @ApiOperation({
    summary:
      'Groups of images with the same dHash (scoped to accessible clients)',
    description:
      'Key (clientId, dHash); dHash alone with crossClient=true, fullAccess only. Flat images (dHash 0) and unhashed ones are left out.',
  })
  @ApiPaginatedResponse(AdminDuplicateGroupDto)
  @ApiResponse({ status: 403, description: 'crossClient without fullAccess' })
  async listDuplicates(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminDuplicateListQuery = new AdminDuplicateListQuery(),
  ): Promise<PaginatedResult<DuplicateGroup>> {
    if (query.crossClient && !adminUser.fullAccess) {
      throw new ForbiddenException('crossClient requires full access');
    }
    if (query.clientId) assertClientAccess(adminUser, query.clientId);
    return this.imageService.findDuplicateGroups(
      query.clientId ? [query.clientId] : adminUser.allowedClientIds,
      { creatorId: query.creatorId, crossClient: query.crossClient },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get image details' })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  async getImage(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const image = await this.imageService.findAdminImageById(
      id,
      adminUser.actorId,
    );
    if (!image) throw new BadRequestException('Image not found');
    assertClientAccess(adminUser, image.clientId);

    const fullPath = this.route.fullUrl('images', image.id);

    const albums = image.albumItems.map((ai) => ai.album);
    const activeShareLinks = image._count.shareLinks;
    const duplicates = await this.imageService.countDuplicates(
      image,
      adminUser.allowedClientIds,
    );

    return plainToInstance(
      AdminImageResponseDto,
      {
        ...image,
        tags: extractTagNames(image),
        fullPath,
        albums,
        activeShareLinks,
        duplicates,
      },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update image metadata (originalName, isPrivate, tags, description)',
  })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  @Audit('fh_image.updated', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      imageId: req.params.id,
      fields: Object.keys((req.body ?? {}) as Record<string, unknown>),
    }),
  })
  async updateImage(
    @Param('id') id: string,
    @Body() dto: AdminUpdateImageDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const existing = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if ('description' in dto) data.description = dto.description ?? null;
    if (dto.tags !== undefined) {
      const imageTagsInput = buildImageTagCreateInput(
        existing.clientId,
        dto.tags,
      );
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

  @Post('bulk-delete')
  @HttpCode(200)
  @RequirePermission('fileharbor-media.moderate')
  @ApiOperation({
    summary: 'Delete many images in one request (admin)',
    description:
      'Up to 100 ids. Each image is deleted on its own: one that is missing or on a client the admin cannot see lands in `failed` (both read as "Image not found", so the answer leaks nothing) and the rest go ahead.',
  })
  @ApiResponse({ status: 200, type: AdminBulkDeleteResponseDto })
  @Audit('fh_image.deleted', {
    metadata: (r: AdminBulkDeleteResponseDto) => ({
      count: r?.deleted?.length ?? 0,
      imageIds: r?.deleted ?? [],
    }),
  })
  async bulkDeleteImages(
    @Body() dto: AdminBulkDeleteDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminBulkDeleteResponseDto> {
    const clients = await this.imageService.findImageClients(dto.ids);
    const deleted: string[] = [];
    const failed: { id: string; message: string }[] = [];

    // Sequential: each delete touches disk and fires a webhook, no need to burst.
    for (const id of dto.ids) {
      const clientId = clients.get(id);
      if (!clientId || !adminUser.allowedClientIds.includes(clientId)) {
        failed.push({ id, message: 'Image not found' });
        continue;
      }
      try {
        await this.imageService.deleteImage(id, clientId);
        deleted.push(id);
      } catch (err) {
        failed.push({
          id,
          message: err instanceof Error ? err.message : 'Delete failed',
        });
      }
    }

    return { deleted, failed };
  }

  @Delete(':id')
  @RequirePermission('fileharbor-media.moderate')
  @ApiOperation({ summary: 'Force delete an image (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @Audit('fh_image.deleted', {
    // The response is a generic success DTO, so the subject comes from the route.
    metadata: (_r: unknown, req: AuditRequest) => ({ imageId: req.params.id }),
  })
  async deleteImage(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
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

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download image file (admin)',
    description:
      'Download the original image file for any image. Admin JWT replaces the API key. Increments the download counter.',
  })
  @ApiQuery({
    name: 'thumb',
    required: false,
    type: Boolean,
    description: 'Download thumbnail instead of original',
  })
  @ApiResponse({
    status: 200,
    description: 'Image file returned as attachment',
  })
  @ApiResponse({ status: 400, description: 'Image not found' })
  @ApiResponse({
    status: 403,
    description: 'Admin has no access to the given client',
  })
  async downloadImage(
    @Param('id') id: string,
    @Query('thumb') thumb: boolean,
    @Res({ passthrough: true }) res: Response,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<StreamableFile> {
    const image = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, image.clientId);

    const { buffer, mimeType } = await this.imageService.getImageFile(image, {
      thumb: !!thumb,
    });

    // Fire-and-forget download counter increment
    this.imageService
      .incrementDownloads(id, image.clientId)
      .catch(() => undefined);

    const filename = thumb
      ? `${image.originalName.replace(/\.[^.]+$/, '')}_thumb.webp`
      : image.originalName;

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': contentDisposition(filename),
      'Content-Length': buffer!.length.toString(),
    });

    return new StreamableFile(Readable.from(buffer!), {
      type: mimeType,
      length: buffer!.length,
    });
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Serve image file inline (admin)',
    description:
      'Image bytes for the console, private images included. Admin JWT replaces the API key. Counts neither a view nor a download, and never answers with the permission-denied placeholder: no access is a 403.',
  })
  @ApiQuery({
    name: 'thumb',
    required: false,
    type: Boolean,
    description: 'Serve thumbnail instead of original',
  })
  @ApiResponse({
    status: 200,
    description: 'Image file, inline, `Cache-Control: private, max-age=300`',
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({
    status: 403,
    description: 'Admin has no access to the given client',
  })
  async getImageFile(
    @Param('id') id: string,
    @Query('thumb') thumb: boolean,
    @Res({ passthrough: true }) res: Response,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<StreamableFile> {
    const image = await this.imageService.getImageById(id, undefined, false);
    assertClientAccess(adminUser, image.clientId);

    const { buffer, mimeType } = await this.imageService.getImageFile(image, {
      thumb: !!thumb,
    });

    // private: an admin-only response must never land in a shared cache
    res.set({
      'Content-Type': mimeType,
      'Content-Length': buffer!.length.toString(),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(Readable.from(buffer!), {
      type: mimeType,
      length: buffer!.length,
    });
  }

  @Post(':id/tinify-compress')
  @ApiOperation({
    summary: 'Compress image with Tinify (TinyPNG)',
    description:
      'Sends the existing image to Tinify API for additional compression, replaces the original, and regenerates the thumbnail. Returns compression statistics along with the updated image. Requires the client to have Tinify enabled (tinifyActive=true) and a valid API key configured. The compression limit is configurable per client (default: 500/month for free tier).',
  })
  @ApiResponse({
    status: 200,
    description: 'Image compressed successfully with compression stats',
    type: TinifyCompressionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Tinify not enabled, API key not configured, monthly limit reached, image not optimized yet, or already compressed with Tinify',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Image or client not found' })
  @Audit('fh_image.compressed', {
    metadata: (_r: unknown, req: AuditRequest) => ({ imageId: req.params.id }),
  })
  async compressImageWithTinify(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<TinifyCompressionResponseDto> {
    const image = await this.imageService.getImageById(id);
    assertClientAccess(adminUser, image.clientId);

    return this.imageService.compressImageWithTinify(id);
  }
}
