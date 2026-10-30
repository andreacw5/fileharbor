import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Headers,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { sendVideo, videoMulterOptions } from './video-delivery';
import { StorageService } from '@/modules/storage/storage.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { auditClientWrite } from '@/common/client-audit';
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import {
  UploadVideoDto,
  VideoResponseDto,
  ListVideosDto,
  UpdateVideoDto,
  DeleteVideoResponseDto,
} from './dto';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  NoTransform,
  PaginatedResult,
} from '@heyatom/nest-common';

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
    private readonly audit: BastionAuditService,
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
  @ApiCreatedData(VideoResponseDto)
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
  @ApiPaginatedResponse(VideoResponseDto)
  async listVideos(
    @ClientId() clientId: string,
    @Query() query: ListVideosDto,
  ): Promise<PaginatedResult<VideoResponseDto>> {
    return this.videoService.listVideos(
      { clientId, creatorId: query.creatorId, tag: query.tag },
      query,
    );
  }

  @NoTransform()
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
  @ApiOkData(VideoResponseDto)
  async getVideoInfo(
    @Param('id') id: string,
    @ClientId() clientId: string,
  ): Promise<VideoResponseDto> {
    return this.videoService.getVideoMetadata(id, clientId);
  }

  @NoTransform()
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
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    // One view per playback, not per Range chunk
    const video = await this.videoService.getVideoStreamPath(
      id,
      clientId,
      !range || /^bytes=0-/.test(range),
    );
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
        // Browser cache only: the route is X-API-Key gated, so a shared cache
        // (nginx/CDN) must not serve it keyless or after isPrivate flips.
        cacheControl: 'private, max-age=86400',
      },
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update video metadata (tags, description, isPrivate)',
  })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiOkData(VideoResponseDto)
  async updateVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoResponseDto> {
    const validCreatorExternalId =
      this.videoService.validateCreatorExternalId(creatorId);
    const result = await this.videoService.updateVideoMetadata(
      id,
      clientId,
      validCreatorExternalId,
      dto.tags,
      dto.description,
      dto.isPrivate,
    );
    // Not `'isPrivate' in dto`: the DTO's Transform leaves the key as undefined on junk.
    if (typeof dto.isPrivate === 'boolean')
      auditClientWrite(this.audit, 'fh_video.updated', clientId, creatorId, {
        videoId: id,
        fields: ['isPrivate'],
        isPrivate: dto.isPrivate,
      });
    return result;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete video' })
  @ApiParam({ name: 'id', description: 'Video UUID' })
  @ApiOkData(DeleteVideoResponseDto)
  async deleteVideo(
    @Param('id') id: string,
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string | undefined,
  ): Promise<DeleteVideoResponseDto> {
    const result = await this.videoService.deleteVideo(id, clientId);
    auditClientWrite(this.audit, 'fh_video.deleted', clientId, creatorId, {
      videoId: id,
    });
    return result;
  }
}
