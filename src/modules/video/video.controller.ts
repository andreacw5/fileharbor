import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
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
  ApiQuery,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import { VideoService } from './video.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { ClientId, UserId } from '@/modules/client/decorators/client.decorator';
import {
  UploadVideoDto,
  VideoResponseDto,
  ListVideosDto,
  ListVideosResponseDto,
  UpdateVideoDto,
  DeleteVideoResponseDto,
} from './dto';

const videoMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `${uuidv4()}.mp4.tmp`),
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new BadRequestException('Only MP4 files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
};

@ApiTags('Videos')
@ApiSecurity('api-key')
@Controller('videos')
@UseInterceptors(ClientInterceptor)
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(
    private readonly videoService: VideoService,
    private readonly storageService: StorageService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload MP4 video' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, type: VideoResponseDto })
  @UseInterceptors(FileInterceptor('file', videoMulterOptions))
  async uploadVideo(
    @ClientId() clientId: string,
    @UserId() userId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVideoDto,
  ): Promise<VideoResponseDto> {
    if (!file) throw new BadRequestException('No file uploaded');

    const effectiveUserId = dto.userId || userId;
    return this.videoService.uploadVideo(clientId, effectiveUserId, file, dto.tags, dto.description, dto.isPrivate);
  }

  @Get()
  @ApiOperation({ summary: 'List videos (paginated)' })
  @ApiResponse({ status: 200, type: ListVideosResponseDto })
  async listVideos(
    @ClientId() clientId: string,
    @Query() query: ListVideosDto,
  ): Promise<ListVideosResponseDto> {
    return this.videoService.listVideos({
      clientId,
      userId: query.userId,
      tag: query.tag,
      page: query.page,
      perPage: query.perPage,
    });
  }

  @Get(':id/thumb')
  @ApiOperation({ summary: 'Get video thumbnail (WebP)' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  async getThumb(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @Res() res: Response,
  ) {
    const video = await this.videoService.getVideoById(id, clientId);

    if (video.isPrivate) {
      throw new ForbiddenException('This video is private');
    }

    const domain = (video as any).client?.domain || clientId;
    const thumbPath = this.storageService.getVideoFilePath(domain, id, 'thumb');

    let buffer: Buffer;
    try {
      buffer = await this.storageService.readFile(thumbPath);
    } catch {
      throw new NotFoundException('Thumbnail not found');
    }

    const cacheHeader = video.isPrivate ? 'no-store' : 'public, max-age=86400';
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': cacheHeader });
    res.end(buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get video metadata' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  async getVideoInfo(
    @Param('id') id: string,
    @ClientId() clientId: string,
  ): Promise<VideoResponseDto> {
    return this.videoService.getVideoMetadata(id, clientId);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream video (X-Accel-Redirect in prod, createReadStream in dev)' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  async streamVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @Query('download') download: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const video = await this.videoService.getVideoStreamPath(id, clientId);
    const safeName = video.originalName.replace(/["\n\r]/g, '_');
    const disposition = download === 'true'
      ? `attachment; filename="${safeName}"`
      : `inline; filename="${safeName}"`;

    if (process.env.NODE_ENV === 'production') {
      if (video.storagePath.includes('..') || video.storagePath.startsWith('/')) {
        throw new ForbiddenException('Invalid storage path');
      }
      res.set({
        'X-Accel-Redirect': `/internal-videos/${video.storagePath}/original.mp4`,
        'Content-Type': 'video/mp4',
        'Content-Disposition': disposition,
      });
      res.end();
    } else {
      const filePath = this.storageService.getVideoFilePath(video.domain, id, 'original');
      const stat = await fsp.stat(filePath);
      const range = (req.headers as any)?.range as string | undefined;

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

  @Patch(':id')
  @ApiOperation({ summary: 'Update video metadata (tags, description, isPrivate)' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  async updateVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    const validUserId = this.videoService.validateUserId(userId);
    return this.videoService.updateVideoMetadata(id, clientId, validUserId, dto.tags, dto.description, dto.isPrivate);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete video' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 200, type: DeleteVideoResponseDto })
  async deleteVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
  ): Promise<DeleteVideoResponseDto> {
    return this.videoService.deleteVideo(id, clientId);
  }
}
