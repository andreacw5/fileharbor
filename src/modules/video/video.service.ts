import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { WebhookService, WebhookEvent } from '@/modules/webhook/webhook.service';
import { UserService } from '@/modules/user/user.service';
import { RouteHelperService } from '@/utils/route.utils';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import {
  VideoResponseDto,
  ListVideosResponseDto,
  DeleteVideoResponseDto,
  VideoPaginationMetaDto,
} from './dto';
import { buildVideoTagCreateInput, extractVideoTagNames } from '@/modules/tag/tag.utils';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly thumbnailQuality: number;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private webhook: WebhookService,
    private userService: UserService,
    private route: RouteHelperService,
  ) {
    this.thumbnailQuality = parseInt(this.config.get('VIDEO_THUMBNAIL_QUALITY') || '80');
  }

  async uploadVideo(
    clientId: string,
    externalUserId: string | undefined,
    file: Express.Multer.File,
    tags?: string[],
    description?: string,
    isPrivate?: boolean,
    albumId?: string,
  ): Promise<VideoResponseDto> {
    const videoId = uuidv4();
    this.logger.debug(
      `[uploadVideo] Start - ID: ${videoId}, Client: ${clientId}, User: ${externalUserId || 'system'}, File: ${file.originalname}, Size: ${file.size}`,
    );

    try {
      // Validate MP4 magic bytes (ftyp at bytes 4-7)
      const fd = await fs.open(file.path, 'r');
      const magic = Buffer.alloc(8);
      await fd.read(magic, 0, 8, 0);
      await fd.close();
      if (magic.slice(4, 8).toString('ascii') !== 'ftyp') {
        await fs.unlink(file.path).catch(() => {});
        throw new BadRequestException('File is not a valid MP4');
      }

      const client = await this.prisma.client.findUnique({ where: { id: clientId } });
      if (!client) throw new BadRequestException('Client not found');
      const domain = client.domain || clientId;

      let user;
      if (externalUserId) {
        user = await this.userService.resolveUser(clientId, externalUserId);
      } else {
        user = await this.prisma.user.findUnique({
          where: { clientId_externalUserId: { clientId, externalUserId: 'system' } },
        });
        if (!user) throw new BadRequestException('System user not found for client');
      }

      const finalPath = this.storage.getVideoFilePath(domain, videoId, 'original');
      await this.storage.copyFromTemp(file.path, finalPath);

      const thumbPath = this.storage.getVideoFilePath(domain, videoId, 'thumb');
      try {
        await this.storage.extractVideoThumbnail(finalPath, thumbPath, this.thumbnailQuality);
      } catch (err) {
        this.logger.warn(`[uploadVideo] Thumbnail extraction failed for ${videoId}: ${err instanceof Error ? err.message : err}`);
      }

      const storagePath = `${domain}/videos/${videoId}`;
      const videoTagsInput = buildVideoTagCreateInput(clientId, tags);

      let videoMeta = { duration: 0, width: 0, height: 0 };
      try {
        videoMeta = await this.storage.getVideoMetadata(finalPath);
      } catch (err) {
        this.logger.warn(`[uploadVideo] Metadata extraction failed for ${videoId}: ${err instanceof Error ? err.message : err}`);
      }

      const video = await this.prisma.video.create({
        data: {
          id: videoId,
          clientId,
          userId: user.id,
          originalName: file.originalname,
          storagePath,
          mimeType: 'video/mp4',
          size: file.size,
          duration: videoMeta.duration || null,
          width: videoMeta.width || null,
          height: videoMeta.height || null,
          isPrivate: isPrivate || false,
          description: description || null,
          ...(videoTagsInput.length > 0 && { videoTags: { create: videoTagsInput } }),
        },
        include: {
          videoTags: { include: { tag: { select: { name: true } } } },
          user: { select: { id: true, externalUserId: true, username: true } },
          client: { select: { id: true, name: true, domain: true } },
        },
      });

      if (albumId) {
        this.logger.debug(`[uploadVideo] Adding to album - ID: ${videoId}, Album: ${albumId}`);
        await this.addVideoToAlbum(videoId, albumId, clientId);
      }

      this.webhook.sendWebhook(clientId, WebhookEvent.VIDEO_UPLOADED, {
        videoId: video.id,
        originalName: video.originalName,
        size: video.size,
        userId: user.externalUserId,
      }).catch((err) => this.logger.warn(`[uploadVideo] Webhook failed: ${err instanceof Error ? err.message : err}`));

      this.logger.log(`[uploadVideo] Success - ID: ${videoId}, Client: ${clientId}`);
      return this.formatVideoResponse(video);
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }

  async addVideoToAlbum(videoId: string, albumId: string, clientId: string) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, clientId },
    });
    if (!album) throw new NotFoundException(`Album ${albumId} not found`);

    const maxItem = await this.prisma.albumItem.findFirst({
      where: { albumId },
      orderBy: { order: 'desc' },
    });
    const order = maxItem ? maxItem.order + 1 : 0;

    return this.prisma.albumItem.create({
      data: { albumId, videoId, resourceType: 'VIDEO', order },
    });
  }

  async getVideoById(videoId: string, clientId?: string) {
    const where: any = { id: videoId };
    if (clientId) where.clientId = clientId;

    const video = await this.prisma.video.findFirst({
      where,
      include: {
        videoTags: { include: { tag: { select: { name: true } } } },
        user: { select: { id: true, externalUserId: true, username: true } },
        client: { select: { id: true, name: true, domain: true } },
      },
    });

    if (!video) throw new NotFoundException('Video not found');
    return video;
  }

  async getVideoStreamPath(videoId: string, clientId: string): Promise<{ storagePath: string; domain: string; originalName: string }> {
    const video = await this.getVideoById(videoId, clientId);

    if (video.isPrivate) {
      throw new ForbiddenException('This video is private');
    }

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    const domain = client?.domain || clientId;

    this.prisma.video.update({ where: { id: videoId }, data: { views: { increment: 1 } } }).catch(() => {});

    return { storagePath: video.storagePath, domain, originalName: video.originalName };
  }

  async listVideos(filters: {
    clientId: string;
    userId?: string;
    tag?: string;
    page?: number;
    perPage?: number;
  }): Promise<ListVideosResponseDto> {
    const page = Math.max(filters.page || 1, 1);
    const perPage = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * perPage;

    const where: any = { clientId: filters.clientId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.tag) {
      where.videoTags = { some: { tag: { name: filters.tag } } };
    }

    const [videos, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
        include: {
          videoTags: { include: { tag: { select: { name: true } } } },
          user: { select: { id: true, externalUserId: true, username: true } },
          client: { select: { id: true, name: true, domain: true } },
        },
      }),
      this.prisma.video.count({ where }),
    ]);

    const data = videos.map((v) => this.formatVideoResponse(v));
    const pagination = plainToInstance(
      VideoPaginationMetaDto,
      { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      { excludeExtraneousValues: true },
    );

    return plainToInstance(ListVideosResponseDto, { data, pagination }, { excludeExtraneousValues: true });
  }

  async deleteVideo(videoId: string, clientId: string): Promise<DeleteVideoResponseDto> {
    const video = await this.prisma.video.findFirst({ where: { id: videoId, clientId } });
    if (!video) throw new NotFoundException('Video not found');

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    const domain = client?.domain || clientId;

    const videoDir = this.storage.getVideoPath(domain, videoId);
    await this.storage.deleteDirectory(videoDir);
    await this.prisma.video.delete({ where: { id: videoId } });

    this.webhook.sendWebhook(clientId, WebhookEvent.VIDEO_DELETED, {
      id: videoId,
      timestamp: new Date().toISOString(),
    }).catch((err) => this.logger.warn(`[deleteVideo] Webhook failed: ${err instanceof Error ? err.message : err}`));

    return plainToInstance(DeleteVideoResponseDto, { success: true, message: 'Video deleted successfully' }, { excludeExtraneousValues: true });
  }

  async updateVideoMetadata(
    videoId: string,
    clientId: string,
    userId: string,
    tags?: string[],
    description?: string,
    isPrivate?: boolean,
  ): Promise<VideoResponseDto> {
    const video = await this.prisma.video.findFirst({ where: { id: videoId, clientId, userId } });
    if (!video) throw new NotFoundException('Video not found');

    const videoTagsInput = tags !== undefined ? buildVideoTagCreateInput(clientId, tags) : undefined;

    const updated = await this.prisma.video.update({
      where: { id: videoId },
      data: {
        ...(description !== undefined && { description }),
        ...(isPrivate !== undefined && { isPrivate }),
        ...(videoTagsInput !== undefined && {
          videoTags: {
            deleteMany: {},
            ...(videoTagsInput.length > 0 && { create: videoTagsInput }),
          },
        }),
      },
      include: {
        videoTags: { include: { tag: { select: { name: true } } } },
        user: { select: { id: true, externalUserId: true, username: true } },
        client: { select: { id: true, name: true, domain: true } },
      },
    });

    return this.formatVideoResponse(updated);
  }

  async getVideoMetadata(videoId: string, clientId?: string): Promise<VideoResponseDto> {
    const video = await this.getVideoById(videoId, clientId);
    return this.formatVideoResponse(video);
  }

  validateUserId(userId: string | undefined): string {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return userId;
  }

  async findAdminVideos(
    where: any,
    options: { skip: number; take: number; page: number },
    sort?: { field: string; order: 'asc' | 'desc' },
    adminUserId?: string,
  ) {
    const orderBy: any = sort ? { [sort.field]: sort.order } : { createdAt: 'desc' };

    const [videos, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        orderBy,
        skip: options.skip,
        take: options.take,
        include: {
          videoTags: { include: { tag: { select: { name: true } } } },
          user: { select: { id: true, externalUserId: true, username: true } },
          client: { select: { name: true, domain: true } },
        },
      }),
      this.prisma.video.count({ where }),
    ]);

    let bookmarkedIds = new Set<string>();
    if (adminUserId && videos.length > 0) {
      const bookmarks = await (this.prisma as any).adminVideoBookmark.findMany({
        where: { adminUserId, videoId: { in: videos.map((v) => v.id) } },
        select: { videoId: true },
      });
      bookmarkedIds = new Set(bookmarks.map((b: any) => b.videoId));
    }

    const data = videos.map((video) => ({
      ...video,
      tags: extractVideoTagNames(video),
      isBookmarked: bookmarkedIds.has(video.id),
    }));

    return {
      data,
      pagination: {
        page: options.page,
        perPage: options.take,
        total,
        totalPages: Math.ceil(total / options.take),
      },
    };
  }

  async findAdminVideoById(videoId: string, adminUserId?: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: {
        videoTags: { include: { tag: { select: { name: true } } } },
        client: { select: { id: true, name: true, domain: true } },
        user: { select: { id: true, externalUserId: true, username: true } },
      },
    });

    if (!video) return null;

    let isBookmarked = false;
    if (adminUserId) {
      const bookmark = await (this.prisma as any).adminVideoBookmark.findUnique({
        where: { adminUserId_videoId: { adminUserId, videoId } },
        select: { videoId: true },
      });
      isBookmarked = !!bookmark;
    }

    return { ...video, isBookmarked };
  }

  async adminUpdateVideo(videoId: string, data: Record<string, any>) {
    return this.prisma.video.update({
      where: { id: videoId },
      data,
      include: {
        videoTags: { include: { tag: { select: { name: true } } } },
        client: { select: { id: true, name: true, domain: true } },
        user: { select: { id: true, externalUserId: true, username: true } },
      },
    });
  }

  formatVideoResponse(video: any): VideoResponseDto {
    return plainToInstance(
      VideoResponseDto,
      {
        ...video,
        tags: extractVideoTagNames(video),
        fullPath: this.route.fullUrl('videos', video.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl('videos', video.id, 'thumb'),
      },
      { excludeExtraneousValues: true },
    );
  }
}
