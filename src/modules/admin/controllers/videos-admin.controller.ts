import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
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
import {
  buildVideoTagCreateInput,
  extractVideoTagNames,
  normalizeTagNames,
} from '@/modules/tag/tag.utils';
import { VideoService } from '@/modules/video/video.service';
import { sendVideo, videoMulterOptions } from '@/modules/video/video-delivery';
import { StorageService } from '@/modules/storage/storage.service';
import { RouteHelperService } from '@/utils/route.utils';
import {
  AdminDeleteResponseDto,
  AdminVideoResponseDto,
  AdminVideoListResponseDto,
} from '../dto/admin-response.dto';

@ApiTags('Admin - Videos')
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
  @ApiResponse({ status: 201, type: AdminVideoResponseDto })
  @UseInterceptors(FileInterceptor('file', videoMulterOptions))
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
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'creatorId', required: false })
  @ApiQuery({ name: 'albumId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'tags', required: false, isArray: true })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'size', 'originalName', 'views', 'downloads'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminVideoListResponseDto })
  async listVideos(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('creatorId') creatorId?: string,
    @Query('albumId') albumId?: string,
    @Query('name') name?: string,
    @Query('tags') tags?: string | string[],
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
      where.albumItems = { some: { albumId, resourceType: 'VIDEO' } };
    if (name) where.originalName = { contains: name, mode: 'insensitive' };
    if (tagsArray && tagsArray.length > 0) {
      where.videoTags = {
        some: { tag: { name: { in: normalizeTagNames(tagsArray) } } },
      };
    }

    const result = await this.videoService.findAdminVideos(
      where,
      { skip, take, page: pageNum },
      { field: validSortBy, order: validSortOrder },
      adminUser.actorId,
    );

    return {
      ...result,
      data: result.data.map((v) =>
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
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get video details (admin)' })
  @ApiResponse({ status: 200, type: AdminVideoResponseDto })
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
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        originalName: { type: 'string' },
        isPrivate: { type: 'boolean' },
        description: { type: 'string', nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 200, type: AdminVideoResponseDto })
  @Audit('fh_video.updated', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      videoId: req.params.id,
      fields: Object.keys((req.body ?? {}) as Record<string, unknown>),
    }),
  })
  async updateVideo(
    @Param('id') id: string,
    @Body()
    dto: {
      originalName?: string;
      isPrivate?: boolean;
      description?: string;
      tags?: string[];
    },
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

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete a video (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
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
