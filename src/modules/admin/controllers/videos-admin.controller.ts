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
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
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
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import type { Request, Response } from 'express';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { assertClientAccess, buildClientWhere } from '../helpers/admin-access.helper';
import { buildVideoTagCreateInput, extractVideoTagNames, normalizeTagNames } from '@/modules/tag/tag.utils';
import { VideoService } from '@/modules/video/video.service';
import { StorageService } from '@/modules/storage/storage.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminDeleteResponseDto, AdminVideoResponseDto } from '../dto/admin-response.dto';

const videoMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req: any, _file: any, cb: any) => cb(null, `${uuidv4()}.mp4.tmp`),
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new BadRequestException('Only MP4 files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
};

@ApiTags('Admin - Videos')
@Controller('admin/videos')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class VideosAdminController {
  constructor(
    private readonly videoService: VideoService,
    private readonly storage: StorageService,
    private readonly route: RouteHelperService,
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
        externalUserId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, type: AdminVideoResponseDto })
  @UseInterceptors(FileInterceptor('file', videoMulterOptions))
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @Body('externalUserId') externalUserId: string | undefined,
    @Body('description') description: string | undefined,
    @Body('isPrivate') isPrivateRaw: string | undefined,
    @AdminUser() adminUser: AdminJwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!clientId) throw new BadRequestException('clientId is required');
    assertClientAccess(adminUser, clientId);

    const isPrivate = isPrivateRaw === 'true' || isPrivateRaw === '1';
    const result = await this.videoService.uploadVideo(clientId, externalUserId, file, [], description, isPrivate);

    return plainToInstance(
      AdminVideoResponseDto,
      {
        ...result,
        fullPath: this.route.fullUrl('admin', 'videos', result.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl('admin', 'videos', result.id, 'thumb'),
      },
      { excludeExtraneousValues: true },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List videos (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'albumId', required: false })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'tags', required: false, isArray: true })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'size', 'originalName', 'views', 'downloads'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listVideos(
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

    const allowedSortFields = ['createdAt', 'size', 'originalName', 'views', 'downloads'];
    const validSortBy = sortBy && allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const validSortOrder = sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : 'desc';

    const where: any = buildClientWhere(adminUser, clientId);
    if (userId) where.user = { id: userId };
    if (albumId) where.albumItems = { some: { albumId, resourceType: 'VIDEO' } };
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
      adminUser.adminUserId,
    );

    return {
      ...result,
      data: result.data.map((v) =>
        plainToInstance(
          AdminVideoResponseDto,
          {
            ...v,
            fullPath: this.route.fullUrl('admin', 'videos', v.id, 'stream'),
            fullThumbnailUrl: this.route.fullUrl('admin', 'videos', v.id, 'thumb'),
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
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminVideoResponseDto> {
    const video = await this.videoService.findAdminVideoById(id, adminUser.adminUserId);
    if (!video) throw new BadRequestException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    return plainToInstance(
      AdminVideoResponseDto,
      {
        ...video,
        tags: extractVideoTagNames(video),
        fullPath: this.route.fullUrl('admin', 'videos', video.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl('admin', 'videos', video.id, 'thumb'),
      },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update video metadata (admin)' })
  @ApiResponse({ status: 200, type: AdminVideoResponseDto })
  async updateVideo(
    @Param('id') id: string,
    @Body() dto: { originalName?: string; isPrivate?: boolean; description?: string; tags?: string[] },
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminVideoResponseDto> {
    const existing = await this.videoService.getVideoById(id);
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if ('description' in dto) data.description = dto.description ?? null;
    if (dto.tags !== undefined) {
      const videoTagsInput = buildVideoTagCreateInput(existing.clientId, dto.tags);
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
        fullThumbnailUrl: this.route.fullUrl('admin', 'videos', updated.id, 'thumb'),
      },
      { excludeExtraneousValues: true },
    );
  }

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Get video thumbnail (admin, JWT auth)' })
  async getThumb(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
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

    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' });
    res.end(buffer);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream video (admin, JWT auth, Range support)' })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  async streamVideo(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('download') download: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const video = await this.videoService.findAdminVideoById(id);
    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    const domain = (video as any).client?.domain || video.clientId;
    const safeName = video.originalName.replace(/["\n\r]/g, '_');
    const disposition = download === 'true'
      ? `attachment; filename="${safeName}"`
      : `inline; filename="${safeName}"`;

    if (process.env.NODE_ENV === 'production') {
      if ((video as any).storagePath.includes('..') || (video as any).storagePath.startsWith('/')) {
        throw new ForbiddenException('Invalid storage path');
      }
      res.set({
        'X-Accel-Redirect': `/internal-videos/${(video as any).storagePath}/original.mp4`,
        'Content-Type': 'video/mp4',
        'Content-Disposition': disposition,
      });
      res.end();
    } else {
      const filePath = this.storage.getVideoFilePath(domain, id, 'original');
      const stat = await fsp.stat(filePath);
      const range = req.headers?.range as string | undefined;

      if (range) {
        const [startStr, endStr] = range.replace(/^bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1_048_576, stat.size - 1);

        if (isNaN(start) || isNaN(end) || start < 0 || end >= stat.size || start > end) {
          res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
          return;
        }

        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': 'video/mp4',
          'Content-Disposition': disposition,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.set({
          'Content-Type': 'video/mp4',
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Content-Disposition': disposition,
        });
        fs.createReadStream(filePath).pipe(res);
      }
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete a video (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  async deleteVideo(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
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
