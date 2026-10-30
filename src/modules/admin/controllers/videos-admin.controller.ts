import { SkipThrottle } from '@nestjs/throttler';
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import type { Response } from 'express';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import { parseBooleanQuery } from '../helpers/admin-query.helper';
import {
  buildVideoTagCreateInput,
  extractVideoTagNames,
  normalizeTagNames,
} from '@/modules/tag/tag.utils';
import { VideoService } from '@/modules/video/video.service';
import {
  sendVideo,
  videoMulterOptions,
  removeVideoTempFile,
} from '@/modules/video/video-delivery';
import { StorageService } from '@/modules/storage/storage.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminVideoListQuery } from '../dto/admin-list-query.dto';
import { AdminUpdateVideoDto } from '../dto/admin-update-video.dto';
import {
  AdminDeleteResponseDto,
  AdminVideoResponseDto,
  RegenerateResponseDto,
} from '../dto/admin-response.dto';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  NoTransform,
  paginate,
} from '@heyatom/nest-common';

@ApiTags('Admin - Videos')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/videos')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-library.manage')
export class VideosAdminController {
  constructor(
    private readonly videoService: VideoService,
    private readonly storage: StorageService,
    private readonly route: RouteHelperService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload video on behalf of a client (admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'clientId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        clientId: { type: 'string', format: 'uuid' },
        externalId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedData(AdminVideoResponseDto)
  @UseInterceptors(
    removeVideoTempFile,
    FileInterceptor('file', videoMulterOptions),
  )
  @Audit('fh_video.uploaded', {
    metadata: (r: { id?: string }, req: AuditRequest) => ({
      videoId: r?.id,
      clientId: (req.body as { clientId?: string })?.clientId,
    }),
  })
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @Body('externalId') externalId: string | undefined,
    @Body('description') description: string | undefined,
    @Body('isPrivate') isPrivateRaw: string | undefined,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!clientId) throw new BadRequestException('clientId is required');
    assertClientAccess(adminUser, clientId);

    const isPrivate = isPrivateRaw === 'true' || isPrivateRaw === '1';
    const result = await this.videoService.uploadVideo(
      clientId,
      externalId,
      file,
      [],
      description,
      isPrivate,
    );

    return plainToInstance(
      AdminVideoResponseDto,
      {
        ...result,
        fullPath: this.route.fullUrl('admin', 'videos', result.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl(
          'admin',
          'videos',
          result.id,
          'thumb',
        ),
      },
      { excludeExtraneousValues: true },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List videos (scoped to accessible clients)' })
  @ApiPaginatedResponse(AdminVideoResponseDto)
  async listVideos(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminVideoListQuery,
  ) {
    const { clientId, creatorId, albumId, name, tags, isPrivate } = query;
    const tagsArray = tags
      ? Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
      : undefined;

    const where: any = buildClientWhere(adminUser, clientId);
    if (creatorId) where.creator = { id: creatorId };
    if (albumId)
      where.albumItems = { some: { albumId, resourceType: 'VIDEO' } };
    if (name) where.originalName = { contains: name, mode: 'insensitive' };
    const privacy = parseBooleanQuery('isPrivate', isPrivate);
    if (privacy !== undefined) where.isPrivate = privacy;
    if (tagsArray && tagsArray.length > 0) {
      where.videoTags = {
        some: { tag: { name: { in: normalizeTagNames(tagsArray) } } },
      };
    }

    const result = await this.videoService.findAdminVideos(
      where,
      query,
      { field: query.sortBy, order: query.sortOrder },
      adminUser.actorId,
    );

    return paginate(
      result.data.map((v) =>
        plainToInstance(
          AdminVideoResponseDto,
          {
            ...v,
            fullPath: this.route.fullUrl('admin', 'videos', v.id, 'stream'),
            fullThumbnailUrl: this.route.fullUrl(
              'admin',
              'videos',
              v.id,
              'thumb',
            ),
          },
          { excludeExtraneousValues: true },
        ),
      ),
      result.meta.total,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get video details (admin)' })
  @ApiOkData(AdminVideoResponseDto)
  async getVideo(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminVideoResponseDto> {
    const video = await this.videoService.findAdminVideoById(
      id,
      adminUser.actorId,
    );
    if (!video) throw new BadRequestException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    return plainToInstance(
      AdminVideoResponseDto,
      {
        ...video,
        tags: extractVideoTagNames(video),
        fullPath: this.route.fullUrl('admin', 'videos', video.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl(
          'admin',
          'videos',
          video.id,
          'thumb',
        ),
      },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update video metadata (admin)' })
  @ApiOkData(AdminVideoResponseDto)
  @Audit('fh_video.updated', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      videoId: req.params.id,
      fields: Object.keys((req.body ?? {}) as Record<string, unknown>),
    }),
  })
  async updateVideo(
    @Param('id') id: string,
    @Body() dto: AdminUpdateVideoDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminVideoResponseDto> {
    const existing = await this.videoService.getVideoById(id);
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if ('description' in dto) data.description = dto.description ?? null;
    if (dto.tags !== undefined) {
      const videoTagsInput = buildVideoTagCreateInput(
        existing.clientId,
        dto.tags,
      );
      data.videoTags = {
        deleteMany: {},
        ...(videoTagsInput.length > 0 && { create: videoTagsInput }),
      };
    }

    const updated = await this.videoService.adminUpdateVideo(id, data);
    return plainToInstance(
      AdminVideoResponseDto,
      {
        ...updated,
        tags: extractVideoTagNames(updated),
        fullPath: this.route.fullUrl('admin', 'videos', updated.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl(
          'admin',
          'videos',
          updated.id,
          'thumb',
        ),
      },
      { excludeExtraneousValues: true },
    );
  }

  @NoTransform()
  @Get(':id/thumb')
  @ApiOperation({ summary: 'Get video thumbnail (admin, JWT auth)' })
  async getThumb(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Res() res: Response,
  ) {
    const video = await this.videoService.findAdminVideoById(id);
    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    const domain = (video as any).client?.domain || video.clientId;
    const thumbPath = this.storage.getVideoFilePath(domain, id, 'thumb');

    let buffer: Buffer;
    try {
      buffer = await this.storage.readFile(thumbPath);
    } catch {
      throw new NotFoundException('Thumbnail not found');
    }

    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    });
    res.end(buffer);
  }

  @NoTransform()
  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream video (admin, JWT auth, Range support)' })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  async streamVideo(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const video = await this.videoService.findAdminVideoById(id);
    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    const domain = (video as any).client?.domain || video.clientId;
    sendVideo(
      res,
      {
        ...video,
        filePath: this.storage.getVideoFilePath(domain, id, 'original'),
      },
      {
        download: download === 'true',
        xAccelRedirect: this.config.get<boolean>('video.xAccelRedirect'),
      },
    );
  }

  @Post(':id/regenerate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Regenerate the thumbnail',
    description:
      'Rebuilds thumb.webp from the stored original (first frame, VIDEO_THUMBNAIL_QUALITY); id, original and metadata are untouched. Same contract as POST admin/images/:id/regenerate.',
  })
  @ApiOkData(RegenerateResponseDto)
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Video or original file not found' })
  @ApiResponse({
    status: 422,
    description: 'Original file is not a readable video',
  })
  @Audit('fh_video.regenerated', {
    metadata: (_r: unknown, req: AuditRequest) => ({ videoId: req.params.id }),
  })
  async regenerateVideo(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<RegenerateResponseDto> {
    const video = await this.videoService.findAdminVideoById(id);
    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    return plainToInstance(
      RegenerateResponseDto,
      await this.videoService.regenerateThumbnail(video),
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete a video (admin)' })
  @ApiOkData(AdminDeleteResponseDto)
  @Audit('fh_video.deleted', {
    metadata: (_r: unknown, req: AuditRequest) => ({ videoId: req.params.id }),
  })
  async deleteVideo(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const video = await this.videoService.getVideoById(id);
    assertClientAccess(adminUser, video.clientId);

    await this.videoService.deleteVideo(id, video.clientId);

    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Video deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }
}
