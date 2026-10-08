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
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import type { Response } from 'express';
import { VideoService } from './video.service';
import { sendVideo, videoMulterOptions } from './video-delivery';
import { StorageService } from '@/modules/storage/storage.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import {
  UploadVideoDto,
  VideoResponseDto,
  ListVideosDto,
  ListVideosResponseDto,
  UpdateVideoDto,
  DeleteVideoResponseDto,
} from './dto';

@ApiTags('Videos')
@ApiSecurity('api-key')
@Controller('videos')
@UseInterceptors(ClientInterceptor)
export class VideoController {
  private readonly logger = new Logger(VideoController.name);

  constructor(
    private readonly videoService: VideoService,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
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
    @CreatorExternalId() creatorId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadVideoDto,
  ): Promise<VideoResponseDto> {
    if (!file) throw new BadRequestException('No file uploaded');

    const effectiveCreatorExternalId = dto.creatorId || creatorId;
    return this.videoService.uploadVideo(
      clientId,
      effectiveCreatorExternalId,
      file,
      dto.tags,
      dto.description,
      dto.isPrivate,
      dto.albumId,
    );
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
      creatorId: query.creatorId,
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
  @ApiOperation({
    summary: 'Stream video (X-Accel-Redirect in prod, createReadStream in dev)',
  })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  async streamVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    const video = await this.videoService.getVideoStreamPath(id, clientId);
    sendVideo(
      res,
      {
        ...video,
        filePath: this.storageService.getVideoFilePath(
          video.domain,
          id,
          'original',
        ),
      },
      {
        download: download === 'true',
        xAccelRedirect: this.config.get<boolean>('video.xAccelRedirect'),
      },
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update video metadata (tags, description, isPrivate)',
  })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  async updateVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    const validCreatorExternalId =
      this.videoService.validateCreatorExternalId(creatorId);
    return this.videoService.updateVideoMetadata(
      id,
      clientId,
      validCreatorExternalId,
      dto.tags,
      dto.description,
      dto.isPrivate,
    );
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
