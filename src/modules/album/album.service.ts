import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { WebhookService, WebhookEvent } from '@/modules/webhook/webhook.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateAlbumDto, UpdateAlbumDto } from './dto';

@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(
    private prisma: PrismaService,
    private webhook: WebhookService,
    private config: ConfigService,
  ) {}

  /**
   * Create album
   */
  async createAlbum(
    clientId: string,
    userId: string,
    dto: CreateAlbumDto,
  ) {
    this.logger.debug(
      `[createAlbum] Start - Client: ${clientId}, User: ${userId}, Name: ${dto.name}, Public: ${dto.isPublic}`
    );

    try {
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

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_CREATED, {
        albumId: album.id,
        externalAlbumId: album.externalAlbumId,
        name: album.name,
        description: album.description,
        isPublic: album.isPublic,
        userId,
      }).catch((error) => {
        this.logger.warn(
          `[createAlbum] Failed to send webhook for album ${album.id}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(`[createAlbum] Success - Album ID: ${album.id}, Client: ${clientId}`);
      return this.formatAlbumResponse(album);
    } catch (error) {
      this.logger.error(`[createAlbum] Failed - Client: ${clientId}, Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get album by ID
   */
  async getAlbumById(albumId: string, clientId: string) {
    const album = await this.prisma.album.findFirst({
      where: {
        id: albumId,
        clientId,
      },
      include: {
        _count: {
          select: { albumImages: true },
        },
        albumImages: {
          take: 1,
          orderBy: {
            order: 'asc',
          },
          include: {
            image: true,
          },
        },
      },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    return album;
  }

  /**
   * Get album with images
   */
  async getAlbumWithImages(albumId: string, clientId: string, userId?: string) {
    const album = await this.getAlbumById(albumId, clientId);

    // Check access
    if (!album.isPublic && album.userId !== userId) {
      throw new ForbiddenException('Access denied to private album');
    }

    return {
      ...this.formatAlbumResponse(album),
      imageCount: album._count.albumImages,
      coverUrl: album.albumImages[0]?.image
        ? this.buildImageFullPath(album.albumImages[0].image.id)
        : undefined,
    };
  }

  /**
   * Get user albums
   */
  async getUserAlbums(clientId: string, userId: string) {
    const albums = await this.prisma.album.findMany({
      where: {
        clientId,
        userId,
      },
      include: {
        _count: {
          select: { albumImages: true },
        },
        albumImages: {
          take: 1,
          orderBy: {
            order: 'asc',
          },
          include: {
            image: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return albums.map((album) => ({
      ...this.formatAlbumResponse(album),
      imageCount: album._count.albumImages,
      coverUrl: album.albumImages[0]?.image
        ? this.buildImageFullPath(album.albumImages[0].image.id)
        : undefined,
    }));
  }

  /**
   * List albums with filtering
   */
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
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    if (filters.userId) {
      where.userId = filters.userId;
    }
    if (filters.public !== undefined) {
      where.isPublic = filters.public;
    }
    if (filters.search) {
      where.name = {
        contains: filters.search,
        mode: 'insensitive',
      };
    }

    const [albums, total] = await Promise.all([
      this.prisma.album.findMany({
        where,
        include: {
          _count: {
            select: { albumImages: true },
          },
          albumImages: {
            take: 1,
            orderBy: {
              order: 'asc',
            },
            include: {
              image: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: perPage,
      }),
      this.prisma.album.count({ where }),
    ]);

    return {
      data: albums.map((album) => ({
        ...this.formatAlbumResponse(album),
        imageCount: album._count.albumImages,
        coverUrl: album.albumImages[0]?.image
          ? this.buildImageFullPath(album.albumImages[0].image.id)
          : undefined,
      })),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Update album
   */
  async updateAlbum(
    albumId: string,
    clientId: string,
    userId: string,
    dto: UpdateAlbumDto,
  ) {
    this.logger.debug(
      `[updateAlbum] Start - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[updateAlbum] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only update your own albums');
    }

    try {
      const updated = await this.prisma.album.update({
        where: { id: albumId },
        data: {
          externalAlbumId: dto.externalAlbumId,
          name: dto.name,
          description: dto.description,
          isPublic: dto.isPublic,
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_UPDATED, {
        albumId: updated.id,
        externalAlbumId: updated.externalAlbumId,
        name: updated.name,
        description: updated.description,
        isPublic: updated.isPublic,
        userId,
      }).catch((error) => {
        this.logger.warn(
          `[updateAlbum] Failed to send webhook for album ${updated.id}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(`[updateAlbum] Success - Album ID: ${albumId}`);
      return this.formatAlbumResponse(updated);
    } catch (error) {
      this.logger.error(`[updateAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete album
   */
  async deleteAlbum(albumId: string, clientId: string, userId: string) {
    this.logger.debug(
      `[deleteAlbum] Start - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[deleteAlbum] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only delete your own albums');
    }

    try {
      await this.prisma.album.delete({
        where: { id: albumId },
      });

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_DELETED, {
        id: albumId,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        this.logger.warn(
          `[deleteAlbum] Failed to send webhook for album ${albumId}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(`[deleteAlbum] Success - Album ID: ${albumId}`);
      return { success: true, message: 'Album deleted successfully' };
    } catch (error) {
      this.logger.error(`[deleteAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Admin paginated album listing — accepts a pre-built Prisma where clause
   * and adds admin-specific includes (user, client, activeTokens count).
   * The caller is responsible for computing skip and take.
   */
  async findAdminAlbums(
    where: any,
    options: { skip: number; take: number },
  ) {
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
          _count: { select: { albumImages: true, albumTokens: { where: activeTokensWhere } } },
        },
      }),
      this.prisma.album.count({ where }),
    ]);

    return { albums, total };
  }

  /**
   * Admin full album fetch — includes user and active token count.
   * Returns null if not found.
   */
  async findAdminAlbumById(albumId: string) {
    const now = new Date();
    return this.prisma.album.findUnique({
      where: { id: albumId },
      include: {
        user: { select: { externalUserId: true, username: true } },
        _count: {
          select: {
            albumImages: true,
            albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    });
  }

  /**
   * Admin album update — bypasses ownership check.
   * Accepts a fully-formed Prisma data object and returns the enriched result.
   */
  async adminUpdateAlbum(albumId: string, data: Record<string, any>) {
    const now = new Date();
    return this.prisma.album.update({
      where: { id: albumId },
      data,
      include: {
        user: { select: { externalUserId: true, username: true } },
        _count: {
          select: {
            albumImages: true,
            albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    });
  }

  /**
   * Get album by internal ID only — no client scope (admin access-check use).
   * Returns null if not found.
   */
  async getAlbumByIdUnscoped(albumId: string) {
    return this.prisma.album.findUnique({ where: { id: albumId } });
  }

  /**
   * Force-add images to an album (admin use — bypasses ownership check).
   * Verifies that the album and all images belong to the given clientId.
   */
  async forceAddImagesToAlbum(
    albumId: string,
    clientId: string,
    imageIds: string[],
  ): Promise<{ albumId: string; images: { imageId: string; order: number }[] }> {
    this.logger.debug(
      `[forceAddImagesToAlbum] Start - Album ID: ${albumId}, Client: ${clientId}, Images: ${imageIds.length}`,
    );

    const album = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!album) throw new NotFoundException('Album not found');

    // Verify all images belong to the client (no ownership restriction for admin)
    const images = await this.prisma.image.findMany({
      where: { id: { in: imageIds }, clientId },
    });

    if (images.length !== imageIds.length) {
      throw new NotFoundException('Some images not found or do not belong to this client');
    }

    const maxOrder = await this.prisma.albumImage.findFirst({
      where: { albumId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    let currentOrder = (maxOrder?.order || 0) + 1;

    const albumImages = await Promise.all(
      imageIds.map((imageId) =>
        this.prisma.albumImage.upsert({
          where: { albumId_imageId: { albumId, imageId } },
          update: {},
          create: { albumId, imageId, order: currentOrder++ },
        }),
      ),
    );

    albumImages.forEach((ai) => {
      this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_ADDED_TO_ALBUM, {
        albumId,
        imageId: ai.imageId,
        albumName: album.name,
      }).catch((error) => {
        this.logger.warn(
          `[forceAddImagesToAlbum] Webhook failed for image ${ai.imageId} in album ${albumId}: ${error.message}`,
        );
      });
    });

    this.logger.log(`[forceAddImagesToAlbum] Success - Album ID: ${albumId}, Added: ${albumImages.length}`);
    return { albumId, images: albumImages.map((ai) => ({ imageId: ai.imageId, order: ai.order })) };
  }

  /**
   * Force-delete an album by ID scoped to a client (admin use — bypasses ownership check).
   */
  async forceDeleteAlbum(albumId: string, clientId: string): Promise<{ success: boolean; message: string }> {
    const album = await this.prisma.album.findFirst({ where: { id: albumId, clientId } });
    if (!album) throw new NotFoundException('Album not found');

    await this.prisma.album.delete({ where: { id: albumId } });

    this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_DELETED, {
      id: albumId,
      timestamp: new Date().toISOString(),
    }).catch((err) => this.logger.warn(`[forceDeleteAlbum] Webhook failed for album ${albumId}: ${err.message}`));

    this.logger.log(`[forceDeleteAlbum] Success - Album ID: ${albumId}`);
    return { success: true, message: 'Album deleted successfully' };
  }

  /**
   * Add images to album
   */
  async addImagesToAlbum(
    albumId: string,
    clientId: string,
    userId: string,
    imageIds: string[],
  ) {
    this.logger.debug(
      `[addImagesToAlbum] Start - Album ID: ${albumId}, Client: ${clientId}, Images: ${imageIds.length}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[addImagesToAlbum] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only modify your own albums');
    }

    // Verify all images belong to the user
    const images = await this.prisma.image.findMany({
      where: {
        id: { in: imageIds },
        clientId,
        userId,
      },
    });

    if (images.length !== imageIds.length) {
      this.logger.warn(
        `[addImagesToAlbum] Some images not found - Album ID: ${albumId}, Requested: ${imageIds.length}, Found: ${images.length}`
      );
      throw new NotFoundException('Some images not found or unauthorized');
    }

    try {
      // Get max order
      const maxOrder = await this.prisma.albumImage.findFirst({
        where: { albumId },
        orderBy: { order: 'desc' },
        select: { order: true },
      });

      let currentOrder = (maxOrder?.order || 0) + 1;

      // Add images
      const albumImages = await Promise.all(
        imageIds.map((imageId) =>
          this.prisma.albumImage.upsert({
            where: {
              albumId_imageId: {
                albumId,
                imageId,
              },
            },
            update: {},
            create: {
              albumId,
              imageId,
              order: currentOrder++,
            },
          }),
        ),
      );

      // Send webhook notifications for each image added (non-blocking)
      albumImages.forEach((ai) => {
        this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_ADDED_TO_ALBUM, {
          albumId,
          imageId: ai.imageId,
          albumName: album.name,
        }).catch((error) => {
          this.logger.warn(
            `[addImagesToAlbum] Failed to send webhook for image ${ai.imageId} added to album ${albumId}:`,
            error instanceof Error ? error.message : error
          );
        });
      });

      this.logger.log(
        `[addImagesToAlbum] Success - Album ID: ${albumId}`
      );

      return {
        albumId,
        images: albumImages.map((ai) => ({ imageId: ai.imageId, order: ai.order })),
      };
    } catch (error) {
      this.logger.error(
        `[addImagesToAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`
      );
      throw error;
    }
  }


  /**
   * Remove image from album
   */
  async removeImageFromAlbum(
    albumId: string,
    imageId: string,
    clientId: string,
    userId: string,
  ) {
    this.logger.debug(
      `[removeImageFromAlbum] Start - Album ID: ${albumId}, Image ID: ${imageId}, Client: ${clientId}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[removeImageFromAlbum] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only modify your own albums');
    }

    try {
      await this.prisma.albumImage.delete({
        where: {
          albumId_imageId: {
            albumId,
            imageId,
          },
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_REMOVED_FROM_ALBUM, {
        albumId,
        imageId,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        this.logger.warn(
          `[removeImageFromAlbum] Failed to send webhook for image ${imageId} removed from album ${albumId}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(`[removeImageFromAlbum] Success - Album ID: ${albumId}, Image ID: ${imageId}`);
      return { success: true, message: 'Image removed from album' };
    } catch (error) {
      this.logger.error(
        `[removeImageFromAlbum] Failed - Album ID: ${albumId}, Image ID: ${imageId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Generate access token for private album
   */
  async generateAlbumToken(
    albumId: string,
    clientId: string,
    userId: string,
    expiresInDays?: number,
  ) {
    this.logger.debug(
      `[generateAlbumToken] Start - Album ID: ${albumId}, Client: ${clientId}, Expires: ${expiresInDays} days`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[generateAlbumToken] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only generate tokens for your own albums');
    }

    try {
      const token = uuidv4();
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      await this.prisma.albumToken.create({
        data: {
          albumId,
          token,
          expiresAt,
        },
      });

      this.logger.log(
        `[generateAlbumToken] Success - Album ID: ${albumId}, Token: ${token}, Expires: ${expiresAt?.toISOString() || 'never'}`
      );

      return {
        token,
        albumId,
        expiresAt,
        url: `/v2/albums/shared/${token}`,
      };
    } catch (error) {
      this.logger.error(
        `[generateAlbumToken] Failed - Album ID: ${albumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Validate album token
   */
  async validateAlbumToken(albumId: string, token: string) {
    const albumToken = await this.prisma.albumToken.findUnique({
      where: { token },
    });

    if (!albumToken || albumToken.albumId !== albumId) {
      throw new ForbiddenException('Invalid token');
    }

    if (albumToken.expiresAt && albumToken.expiresAt < new Date()) {
      throw new ForbiddenException('Token expired');
    }

    return true;
  }

  /**
   * Get album by shared token (public access)
   */
  async getAlbumBySharedToken(token: string) {
    // First find the token record to get album ID
    const tokenRecord = await this.prisma.albumToken.findUnique({
      where: { token },
    });

    if (!tokenRecord) {
      throw new ForbiddenException('Invalid token');
    }

    // Validate token expiration
    await this.validateAlbumToken(tokenRecord.albumId, token);

    // Get album with count and first image
    const album = await this.prisma.album.findUnique({
      where: { id: tokenRecord.albumId },
      include: {
        _count: {
          select: { albumImages: true },
        },
        albumImages: {
          take: 1,
          orderBy: {
            order: 'asc',
          },
          include: {
            image: true,
          },
        },
      },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    return {
      ...this.formatAlbumResponse(album),
      imageCount: album._count.albumImages,
      coverUrl: album.albumImages[0]?.image
        ? this.buildImageFullPath(album.albumImages[0].image.id)
        : undefined,
    };
  }

  /**
   * Revoke album token
   */
  async revokeAlbumToken(
    albumId: string,
    clientId: string,
    userId: string,
  ) {
    this.logger.debug(
      `[revokeAlbumToken] Start - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[revokeAlbumToken] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only revoke tokens for your own albums');
    }

    try {
      const result = await this.prisma.albumToken.deleteMany({
        where: {
          albumId,
        },
      });

      this.logger.log(
        `[revokeAlbumToken] Success - Album ID: ${albumId}, Revoked: ${result.count} tokens`
      );
      return { success: true, message: 'Album tokens revoked', count: result.count };
    } catch (error) {
      this.logger.error(
        `[revokeAlbumToken] Failed - Album ID: ${albumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Remove images from album (multiple)
   */
  async removeImagesFromAlbum(
    albumId: string,
    clientId: string,
    userId: string,
    imageIds: string[],
  ) {
    this.logger.debug(
      `[removeImagesFromAlbum] Start - Album ID: ${albumId}, Client: ${clientId}, Images: ${imageIds.length}`
    );

    const album = await this.getAlbumById(albumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[removeImagesFromAlbum] Access denied - Album ID: ${albumId}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only modify your own albums');
    }

    try {
      const result = await this.prisma.albumImage.deleteMany({
        where: {
          albumId,
          imageId: {
            in: imageIds,
          },
        },
      });

      this.logger.log(
        `[removeImagesFromAlbum] Success - Album ID: ${albumId}, Removed: ${result.count}`
      );
      return { success: true, message: 'Images removed from album', removed: result.count };
    } catch (error) {
      this.logger.error(
        `[removeImagesFromAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Delete expired album tokens
   */
  async deleteExpiredAlbumTokens(): Promise<number> {
    const result = await this.prisma.albumToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return result.count;
  }

  /**
   * Get album by external ID
   */
  async getAlbumByExternalId(externalAlbumId: string, clientId: string) {
    const album = await this.prisma.album.findUnique({
      where: {
        clientId_externalAlbumId: {
          clientId,
          externalAlbumId,
        },
      },
      include: {
        _count: {
          select: { albumImages: true },
        },
        albumImages: {
          take: 1,
          orderBy: {
            order: 'asc',
          },
          include: {
            image: true,
          },
        },
      },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    return album;
  }

  /**
   * Get album with images by external ID
   */
  async getAlbumWithImagesByExternalId(
    externalAlbumId: string,
    clientId: string,
    userId?: string,
  ) {
    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);

    // Check access
    if (!album.isPublic && album.userId !== userId) {
      throw new ForbiddenException('Access denied to private album');
    }

    return {
      ...this.formatAlbumResponse(album),
      imageCount: album._count.albumImages,
      coverUrl: album.albumImages[0]?.image
        ? this.buildImageFullPath(album.albumImages[0].image.id)
        : undefined,
    };
  }

  /**
   * Update album by external ID
   */
  async updateAlbumByExternalId(
    externalAlbumId: string,
    clientId: string,
    userId: string,
    dto: UpdateAlbumDto,
  ) {
    this.logger.debug(
      `[updateAlbumByExternalId] Start - External ID: ${externalAlbumId}, Client: ${clientId}, User: ${userId}`
    );

    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[updateAlbumByExternalId] Access denied - Album ID: ${album.id}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only update your own albums');
    }

    try {
      const updated = await this.prisma.album.update({
        where: { id: album.id },
        data: {
          externalAlbumId: dto.externalAlbumId || externalAlbumId,
          name: dto.name,
          description: dto.description,
          isPublic: dto.isPublic,
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.ALBUM_UPDATED, {
        albumId: updated.id,
        externalAlbumId: updated.externalAlbumId,
        name: updated.name,
        description: updated.description,
        isPublic: updated.isPublic,
        userId,
      }).catch((error) => {
        this.logger.warn(
          `[updateAlbumByExternalId] Failed to send webhook for album ${updated.id}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(`[updateAlbumByExternalId] Success - Album ID: ${album.id}`);
      return this.formatAlbumResponse(updated);
    } catch (error) {
      this.logger.error(
        `[updateAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Add images to album by external ID
   */
  async addImagesToAlbumByExternalId(
    externalAlbumId: string,
    clientId: string,
    userId: string,
    imageIds: string[],
  ) {
    this.logger.debug(
      `[addImagesToAlbumByExternalId] Start - External ID: ${externalAlbumId}, Client: ${clientId}, Images: ${imageIds.length}`
    );

    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[addImagesToAlbumByExternalId] Access denied - Album ID: ${album.id}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only modify your own albums');
    }

    // Verify all images belong to the user
    const images = await this.prisma.image.findMany({
      where: {
        id: { in: imageIds },
        clientId,
        userId,
      },
    });

    if (images.length !== imageIds.length) {
      this.logger.warn(
        `[addImagesToAlbumByExternalId] Some images not found - Album ID: ${album.id}, Requested: ${imageIds.length}, Found: ${images.length}`
      );
      throw new NotFoundException('Some images not found or unauthorized');
    }

    try {
      // Get max order
      const maxOrder = await this.prisma.albumImage.findFirst({
        where: { albumId: album.id },
        orderBy: { order: 'desc' },
        select: { order: true },
      });

      let currentOrder = (maxOrder?.order || 0) + 1;

      // Add images
      const albumImages = await Promise.all(
        imageIds.map((imageId) =>
          this.prisma.albumImage.upsert({
            where: {
              albumId_imageId: {
                albumId: album.id,
                imageId,
              },
            },
            update: {},
            create: {
              albumId: album.id,
              imageId,
              order: currentOrder++,
            },
          }),
        ),
      );

      // Send webhook notifications for each image added (non-blocking)
      albumImages.forEach((ai) => {
        this.webhook.sendWebhook(clientId, WebhookEvent.IMAGE_ADDED_TO_ALBUM, {
          albumId: album.id,
          externalAlbumId,
          imageId: ai.imageId,
          albumName: album.name,
        }).catch((error) => {
          this.logger.warn(
            `[addImagesToAlbumByExternalId] Failed to send webhook for image ${ai.imageId}:`,
            error instanceof Error ? error.message : error
          );
        });
      });

      this.logger.log(
        `[addImagesToAlbumByExternalId] Success - Album ID: ${album.id}`
      );

      return {
        albumId: album.id,
        externalAlbumId,
        images: albumImages.map((ai) => ({ imageId: ai.imageId, order: ai.order })),
      };
    } catch (error) {
      this.logger.error(
        `[addImagesToAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Remove images from album by external ID
   */
  async removeImagesFromAlbumByExternalId(
    externalAlbumId: string,
    clientId: string,
    userId: string,
    imageIds: string[],
  ) {
    this.logger.debug(
      `[removeImagesFromAlbumByExternalId] Start - External ID: ${externalAlbumId}, Client: ${clientId}, Images: ${imageIds.length}`
    );

    const album = await this.getAlbumByExternalId(externalAlbumId, clientId);

    if (album.userId !== userId) {
      this.logger.warn(
        `[removeImagesFromAlbumByExternalId] Access denied - Album ID: ${album.id}, Owner: ${album.userId}, User: ${userId}`
      );
      throw new ForbiddenException('You can only modify your own albums');
    }

    try {
      const result = await this.prisma.albumImage.deleteMany({
        where: {
          albumId: album.id,
          imageId: {
            in: imageIds,
          },
        },
      });

      this.logger.log(
        `[removeImagesFromAlbumByExternalId] Success - Album ID: ${album.id}, Removed: ${result.count}`
      );
      return { success: true, message: 'Images removed from album', removed: result.count };
    } catch (error) {
      this.logger.error(
        `[removeImagesFromAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Format album response
   */
  private formatAlbumResponse(album: any) {
    return {
      id: album.id,
      externalAlbumId: album.externalAlbumId,
      clientId: album.clientId,
      userId: album.userId,
      name: album.name,
      description: album.description,
      isPublic: album.isPublic,
      createdAt: album.createdAt,
    };
  }

  /**
   * Build full path URL for image
   */
  private buildImageFullPath(imageId: string): string {
    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    return `${baseUrl}/${apiPrefix}/images/${imageId}`;
  }
}

