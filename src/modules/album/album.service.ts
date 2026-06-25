import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AlbumResourceType } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { WebhookService, WebhookEvent } from '@/modules/webhook/webhook.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateAlbumDto, UpdateAlbumDto } from './dto';
import { RouteHelperService } from '@/utils/route.utils';

@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(
    private prisma: PrismaService,
    private webhook: WebhookService,
    private route: RouteHelperService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private coverInclude() {
    return {
      albumItems: {
        where: { resourceType: AlbumResourceType.IMAGE },
        take: 1,
        orderBy: { order: 'asc' as const },
        include: { image: { select: { id: true } } },
      },
    };
  }

  private resolveCoverUrl(album: any): string | undefined {
    const first = album.albumItems?.[0];
    return first?.image ? this.buildImageFullPath(first.image.id) : undefined;
  }

  private buildImageFullPath(imageId: string): string {
    return this.route.fullUrl('images', imageId);
  }

  private async countItemsByType(albumId: string, total: number) {
    const imageCount = await this.prisma.albumItem.count({
      where: { albumId, resourceType: AlbumResourceType.IMAGE },
    });
    return { imageCount, videoCount: total - imageCount };
  }

  private async fetchItemCountMap(albumIds: string[]): Promise<Map<string, { imageCount: number; videoCount: number }>> {
    if (albumIds.length === 0) return new Map();
    const rows = await this.prisma.albumItem.groupBy({
      by: ['albumId', 'resourceType'],
      where: { albumId: { in: albumIds } },
      _count: { _all: true },
    });
    const map = new Map<string, { imageCount: number; videoCount: number }>();
    for (const row of rows) {
      if (!map.has(row.albumId)) map.set(row.albumId, { imageCount: 0, videoCount: 0 });
      const entry = map.get(row.albumId)!;
      if (row.resourceType === AlbumResourceType.IMAGE) entry.imageCount = row._count._all;
      else entry.videoCount = row._count._all;
    }
    return map;
  }

  private mapAlbumItem(item: any) {
    const base = { id: item.id, resourceType: item.resourceType, order: item.order, addedAt: item.addedAt };
    if (item.resourceType === AlbumResourceType.IMAGE && item.image) {
      return {
        ...base,
        image: {
          id: item.image.id,
          originalName: item.image.originalName,
          mimeType: item.image.mimeType,
          width: item.image.width,
          height: item.image.height,
          size: item.image.size,
          tags: item.image.imageTags?.map((t: any) => t.tag.name) ?? [],
          fullPath: this.route.fullUrl('images', item.image.id),
          thumbnailPath: this.route.fullUrl('images', item.image.id, 'thumb'),
        },
      };
    }
    if (item.resourceType === AlbumResourceType.VIDEO && item.video) {
      return {
        ...base,
        video: {
          id: item.video.id,
          originalName: item.video.originalName,
          mimeType: item.video.mimeType,
          duration: item.video.duration,
          width: item.video.width,
          height: item.video.height,
          size: item.video.size,
          tags: item.video.videoTags?.map((t: any) => t.tag.name) ?? [],
          url: this.route.fullUrl('videos', item.video.id),
          thumbnailUrl: this.route.fullUrl('videos', item.video.id, 'thumb'),
        },
      };
    }
    return base;
  }

  private formatAlbumResponse(album: any) {
    return {
      id: album.id,
      externalAlbumId: album.externalAlbumId,
      clientId: album.clientId,
      userId: album.userId,
      name: album.name,
      description: album.description,
      isPublic: album.isPublic,
      coverImageId: album.coverImageId,
      createdAt: album.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Core CRUD
  // ---------------------------------------------------------------------------

  async createAlbum(clientId: string, userId: string, dto: CreateAlbumDto) {
    const album = await this.prisma.album.create({
      data: {
        clientId,
        userId,
        externalAlbumId: dto.externalAlbumId,
        name: dto.name,
        description: dto.description,
        isPublic: dto.isPublic || false,
      },
    });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_CREATED, {
      albumId: album.id,
      externalAlbumId: album.externalAlbumId,
      name: album.name,
      description: album.description,
      isPublic: album.isPublic,
      userId,
    }).catch((e) => this.logger.warn(`[createAlbum] Webhook failed: ${e.message}`));

    this.logger.log(`[createAlbum] Success - Album ID: ${album.id}`);
    return this.formatAlbumResponse(album);
  }

  async getAlbumById(albumId: string, clientId: string) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, clientId },
      include: {
        _count: { select: { albumItems: true } },
        ...this.coverInclude(),
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  async getAlbumWithItems(albumId: string, clientId: string, userId?: string) {
    const album = await this.getAlbumById(albumId, clientId);
    if (!album.isPublic && album.userId !== userId) {
      throw new ForbiddenException('Access denied to private album');
    }
    const { imageCount, videoCount } = await this.countItemsByType(albumId, album._count.albumItems);
    return {
      ...this.formatAlbumResponse(album),
      itemCount: album._count.albumItems,
      imageCount,
      videoCount,
      coverUrl: this.resolveCoverUrl(album),
    };
  }

  async getUserAlbums(clientId: string, userId: string) {
    const albums = await this.prisma.album.findMany({
      where: { clientId, userId },
      include: {
        _count: { select: { albumItems: true } },
        ...this.coverInclude(),
      },
      orderBy: { createdAt: 'desc' },
    });

    const countMap = await this.fetchItemCountMap(albums.map((a) => a.id));

    return albums.map((album) => {
      const { imageCount = 0, videoCount = 0 } = countMap.get(album.id) ?? {};
      return {
        ...this.formatAlbumResponse(album),
        itemCount: album._count.albumItems,
        imageCount,
        videoCount,
        coverUrl: this.resolveCoverUrl(album),
      };
    });
  }

  async listAlbums(filters: {
    clientId?: string;
    userId?: string;
    public?: boolean;
    search?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = filters.page || 1;
    const perPage = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.public !== undefined) where.isPublic = filters.public;
    if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };

    const [albums, total] = await Promise.all([
      this.prisma.album.findMany({
        where,
        include: {
          _count: { select: { albumItems: true } },
          ...this.coverInclude(),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      this.prisma.album.count({ where }),
    ]);

    const countMap = await this.fetchItemCountMap(albums.map((a) => a.id));

    return {
      data: albums.map((album) => {
        const { imageCount = 0, videoCount = 0 } = countMap.get(album.id) ?? {};
        return {
          ...this.formatAlbumResponse(album),
          itemCount: album._count.albumItems,
          imageCount,
          videoCount,
          coverUrl: this.resolveCoverUrl(album),
        };
      }),
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  async updateAlbum(albumId: string, clientId: string, userId: string, dto: UpdateAlbumDto) {
    const album = await this.getAlbumById(albumId, clientId);
    if (album.userId !== userId) throw new ForbiddenException('You can only update your own albums');

    if (dto.coverImageId) {
      await this.validateCoverImageInAlbum(dto.coverImageId, albumId, clientId, userId);
    }

    const updateData: any = {
      externalAlbumId: dto.externalAlbumId,
      name: dto.name,
      description: dto.description,
      isPublic: dto.isPublic,
    };
    if (dto.coverImageId !== undefined) updateData.coverImageId = dto.coverImageId;

    const updated = await this.prisma.album.update({ where: { id: albumId }, data: updateData });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_UPDATED, {
      albumId: updated.id,
      externalAlbumId: updated.externalAlbumId,
      name: updated.name,
      description: updated.description,
      isPublic: updated.isPublic,
      coverImageId: updated.coverImageId,
      userId,
    }).catch((e) => this.logger.warn(`[updateAlbum] Webhook failed: ${e.message}`));

    this.logger.log(`[updateAlbum] Success - Album ID: ${albumId}`);
    return this.formatAlbumResponse(updated);
  }

  async deleteAlbum(albumId: string, clientId: string, userId: string) {
    const album = await this.getAlbumById(albumId, clientId);
    if (album.userId !== userId) throw new ForbiddenException('You can only delete your own albums');

    await this.prisma.album.delete({ where: { id: albumId } });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_DELETED, {
      id: albumId,
      timestamp: new Date().toISOString(),
    }).catch((e) => this.logger.warn(`[deleteAlbum] Webhook failed: ${e.message}`));

    this.logger.log(`[deleteAlbum] Success - Album ID: ${albumId}`);
    return { success: true, message: 'Album deleted successfully' };
  }

  // ---------------------------------------------------------------------------
  // Items (images + videos, unified ordering)
  // ---------------------------------------------------------------------------

  async addItemsToAlbum(
    albumId: string,
    clientId: string,
    items: { id: string; resourceType: AlbumResourceType; order?: number }[],
    options: { userId?: string; force?: boolean } = {},
  ) {
    const album = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!album) throw new NotFoundException('Album not found');

    if (!options.force && options.userId && album.userId !== options.userId) {
      throw new ForbiddenException('You can only modify your own albums');
    }

    const maxOrder = await this.prisma.albumItem.findFirst({
      where: { albumId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    let nextOrder = (maxOrder?.order ?? -1) + 1;

    const results = await Promise.all(
      items.map(async (item, idx) => {
        const isImage = item.resourceType === AlbumResourceType.IMAGE;
        const order = item.order ?? nextOrder + idx;

        if (isImage) {
          const img = await this.prisma.image.findFirst({
            where: {
              id: item.id,
              clientId,
              ...(options.force ? {} : { userId: options.userId }),
            },
          });
          if (!img) throw new NotFoundException(`Image ${item.id} not found or unauthorized`);
        } else {
          const vid = await this.prisma.video.findFirst({
            where: {
              id: item.id,
              clientId,
              ...(options.force ? {} : { userId: options.userId }),
            },
          });
          if (!vid) throw new NotFoundException(`Video ${item.id} not found or unauthorized`);
        }

        const record = await this.prisma.albumItem.upsert({
          where: isImage
            ? { albumId_imageId: { albumId, imageId: item.id } }
            : { albumId_videoId: { albumId, videoId: item.id } },
          create: {
            albumId,
            ...(isImage ? { imageId: item.id } : { videoId: item.id }),
            resourceType: item.resourceType,
            order,
          },
          update: { order },
        });

        if (isImage) {
          this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_ADDED_TO_ALBUM, {
            albumId, imageId: item.id, albumName: album.name,
          }).catch((e) => this.logger.warn(`[addItemsToAlbum] Webhook failed: ${e.message}`));
        }

        return record;
      }),
    );

    this.logger.log(`[addItemsToAlbum] Album: ${albumId}, Added: ${results.length}`);
    return {
      albumId,
      items: results.map((r) => ({ id: r.id, resourceType: r.resourceType, order: r.order })),
      count: results.length,
    };
  }

  async removeItemsFromAlbum(
    albumId: string,
    clientId: string,
    items: { id: string; resourceType: AlbumResourceType }[],
    options: { userId?: string; force?: boolean } = {},
  ) {
    const album = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!album) throw new NotFoundException('Album not found');

    if (!options.force && options.userId && album.userId !== options.userId) {
      throw new ForbiddenException('You can only modify your own albums');
    }

    let removed = 0;
    for (const item of items) {
      const isImage = item.resourceType === AlbumResourceType.IMAGE;
      try {
        await this.prisma.albumItem.delete({
          where: isImage
            ? { albumId_imageId: { albumId, imageId: item.id } }
            : { albumId_videoId: { albumId, videoId: item.id } },
        });
        removed++;

        if (isImage) {
          this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_REMOVED_FROM_ALBUM, {
            albumId, imageId: item.id, timestamp: new Date().toISOString(),
          }).catch((e) => this.logger.warn(`[removeItemsFromAlbum] Webhook failed: ${e.message}`));
        }
      } catch {
        // already removed or not found — skip
      }
    }

    this.logger.log(`[removeItemsFromAlbum] Album: ${albumId}, Removed: ${removed}`);
    return { albumId, removed, success: true, message: `${removed} item(s) removed` };
  }

  async listAlbumItems(
    albumId: string,
    clientId: string,
    params: { resourceType?: AlbumResourceType; page: number; perPage: number },
  ) {
    const albumExists = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!albumExists) throw new NotFoundException('Album not found');

    const where: any = { albumId };
    if (params.resourceType) where.resourceType = params.resourceType;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.albumItem.findMany({
        where,
        orderBy: { order: 'asc' },
        skip: (params.page - 1) * params.perPage,
        take: params.perPage,
        include: {
          image: {
            select: {
              id: true, originalName: true, mimeType: true,
              width: true, height: true, size: true,
              imageTags: { include: { tag: { select: { name: true } } } },
            },
          },
          video: {
            select: {
              id: true, originalName: true, mimeType: true,
              duration: true, width: true, height: true, size: true,
              videoTags: { include: { tag: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.albumItem.count({ where }),
    ]);

    return {
      data: rows.map((item) => this.mapAlbumItem(item)),
      pagination: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.ceil(total / params.perPage),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Token access
  // ---------------------------------------------------------------------------

  async generateAlbumToken(albumId: string, clientId: string, userId: string, expiresInDays?: number) {
    const album = await this.getAlbumById(albumId, clientId);
    if (album.userId !== userId) throw new ForbiddenException('You can only generate tokens for your own albums');

    const token = uuidv4();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    await this.prisma.albumToken.create({ data: { albumId, token, expiresAt } });

    this.logger.log(`[generateAlbumToken] Album: ${albumId}, Expires: ${expiresAt?.toISOString() || 'never'}`);
    return { token, albumId, expiresAt, url: `/v2/albums/shared/${token}` };
  }

  async validateAlbumToken(albumId: string, token: string) {
    const albumToken = await this.prisma.albumToken.findUnique({ where: { token } });
    if (!albumToken || albumToken.albumId !== albumId) throw new ForbiddenException('Invalid token');
    if (albumToken.expiresAt && albumToken.expiresAt < new Date()) throw new ForbiddenException('Token expired');
    return true;
  }

  async getAlbumBySharedToken(token: string) {
    const tokenRecord = await this.prisma.albumToken.findUnique({ where: { token } });
    if (!tokenRecord) throw new ForbiddenException('Invalid token');

    await this.validateAlbumToken(tokenRecord.albumId, token);

    const album = await this.prisma.album.findUnique({
      where: { id: tokenRecord.albumId },
      include: {
        _count: { select: { albumItems: true } },
        ...this.coverInclude(),
      },
    });
    if (!album) throw new NotFoundException('Album not found');

    const { imageCount, videoCount } = await this.countItemsByType(album.id, album._count.albumItems);
    return {
      ...this.formatAlbumResponse(album),
      itemCount: album._count.albumItems,
      imageCount,
      videoCount,
      coverUrl: this.resolveCoverUrl(album),
    };
  }

  async revokeAlbumToken(albumId: string, clientId: string, userId: string) {
    const album = await this.getAlbumById(albumId, clientId);
    if (album.userId !== userId) throw new ForbiddenException('You can only revoke tokens for your own albums');

    const result = await this.prisma.albumToken.deleteMany({ where: { albumId } });
    this.logger.log(`[revokeAlbumToken] Album: ${albumId}, Revoked: ${result.count}`);
    return { success: true, message: 'Album tokens revoked', count: result.count };
  }

  async deleteExpiredAlbumTokens(): Promise<number> {
    const result = await this.prisma.albumToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // External ID routes
  // ---------------------------------------------------------------------------

  async getAlbumByExternalId(externalAlbumId: string, clientId: string) {
    const album = await this.prisma.album.findUnique({
      where: { clientId_externalAlbumId: { clientId, externalAlbumId } },
      include: {
        _count: { select: { albumItems: true } },
        ...this.coverInclude(),
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  async getAlbumWithItemsByExternalId(externalAlbumId: string, clientId: string, userId?: string) {
    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);
    if (!album.isPublic && album.userId !== userId) throw new ForbiddenException('Access denied to private album');

    const { imageCount, videoCount } = await this.countItemsByType(album.id, album._count.albumItems);
    return {
      ...this.formatAlbumResponse(album),
      itemCount: album._count.albumItems,
      imageCount,
      videoCount,
      coverUrl: album.coverImageId
        ? this.buildImageFullPath(album.coverImageId)
        : this.resolveCoverUrl(album),
    };
  }

  async updateAlbumByExternalId(externalAlbumId: string, clientId: string, userId: string, dto: UpdateAlbumDto) {
    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);
    if (album.userId !== userId) throw new ForbiddenException('You can only update your own albums');

    if (dto.coverImageId) {
      await this.validateCoverImageInAlbum(dto.coverImageId, album.id, clientId, userId);
    }

    const updateData: any = {
      externalAlbumId: dto.externalAlbumId || externalAlbumId,
      name: dto.name,
      description: dto.description,
      isPublic: dto.isPublic,
    };
    if (dto.coverImageId !== undefined) updateData.coverImageId = dto.coverImageId;

    const updated = await this.prisma.album.update({ where: { id: album.id }, data: updateData });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_UPDATED, {
      albumId: updated.id,
      externalAlbumId: updated.externalAlbumId,
      name: updated.name,
      description: updated.description,
      isPublic: updated.isPublic,
      coverImageId: updated.coverImageId,
      userId,
    }).catch((e) => this.logger.warn(`[updateAlbumByExternalId] Webhook failed: ${e.message}`));

    return this.formatAlbumResponse(updated);
  }

  async addItemsToAlbumByExternalId(
    externalAlbumId: string,
    clientId: string,
    items: { id: string; resourceType: AlbumResourceType; order?: number }[],
    options: { userId?: string; force?: boolean } = {},
  ) {
    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);
    return this.addItemsToAlbum(album.id, clientId, items, options);
  }

  async removeItemsFromAlbumByExternalId(
    externalAlbumId: string,
    clientId: string,
    items: { id: string; resourceType: AlbumResourceType }[],
    options: { userId?: string; force?: boolean } = {},
  ) {
    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);
    return this.removeItemsFromAlbum(album.id, clientId, items, options);
  }

  // ---------------------------------------------------------------------------
  // Admin methods
  // ---------------------------------------------------------------------------

  async findAdminAlbums(where: any, options: { skip: number; take: number }) {
    const now = new Date();
    const activeTokensWhere = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const [albums, total] = await Promise.all([
      this.prisma.album.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        include: {
          user: { select: { externalUserId: true, username: true } },
          client: { select: { name: true, domain: true } },
          _count: { select: { albumItems: true, albumTokens: { where: activeTokensWhere } } },
        },
      }),
      this.prisma.album.count({ where }),
    ]);

    const countMap = await this.fetchItemCountMap(albums.map((a) => a.id));
    const albumsWithCounts = albums.map((a) => {
      const { imageCount = 0, videoCount = 0 } = countMap.get(a.id) ?? {};
      return { ...a, imageCount, videoCount };
    });

    return { albums: albumsWithCounts, total };
  }

  async findAdminAlbumById(albumId: string) {
    const now = new Date();
    const [album, imageCount] = await Promise.all([
      this.prisma.album.findUnique({
        where: { id: albumId },
        include: {
          client: { select: { id: true, name: true, domain: true } },
          user: { select: { externalUserId: true, username: true } },
          _count: {
            select: {
              albumItems: true,
              albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
            },
          },
        },
      }),
      this.prisma.albumItem.count({ where: { albumId, resourceType: AlbumResourceType.IMAGE } }),
    ]);
    if (!album) return null;
    return { ...album, imageCount, videoCount: album._count.albumItems - imageCount };
  }

  async adminUpdateAlbum(albumId: string, data: Record<string, any>) {
    const now = new Date();
    const [album, imageCount] = await Promise.all([
      this.prisma.album.update({
        where: { id: albumId },
        data,
        include: {
          client: { select: { id: true, name: true, domain: true } },
          user: { select: { externalUserId: true, username: true } },
          _count: {
            select: {
              albumItems: true,
              albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
            },
          },
        },
      }),
      this.prisma.albumItem.count({ where: { albumId, resourceType: AlbumResourceType.IMAGE } }),
    ]);
    return { ...album, imageCount, videoCount: album._count.albumItems - imageCount };
  }

  async getAlbumByIdUnscoped(albumId: string) {
    return this.prisma.album.findUnique({ where: { id: albumId } });
  }

  async forceDeleteAlbum(albumId: string, clientId: string): Promise<{ success: boolean; message: string }> {
    const album = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!album) throw new NotFoundException('Album not found');

    await this.prisma.album.delete({ where: { id: albumId } });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_DELETED, {
      id: albumId,
      timestamp: new Date().toISOString(),
    }).catch((e) => this.logger.warn(`[forceDeleteAlbum] Webhook failed: ${e.message}`));

    return { success: true, message: 'Album deleted successfully' };
  }

  // ---------------------------------------------------------------------------
  // Private validation
  // ---------------------------------------------------------------------------

  private async validateCoverImageInAlbum(
    imageId: string,
    albumId: string,
    clientId: string,
    userId: string,
  ): Promise<void> {
    const item = await this.prisma.albumItem.findUnique({
      where: { albumId_imageId: { albumId, imageId } },
      include: { image: { select: { id: true, clientId: true, userId: true } } },
    });

    if (!item) throw new BadRequestException('Cover image must be part of the album');
    if (item.image!.clientId !== clientId || item.image!.userId !== userId) {
      throw new BadRequestException('Cover image does not belong to this client or user');
    }
  }
}
