import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateAlbumDto, UpdateAlbumDto } from './dto';

@Injectable()
export class AlbumService {
  private readonly logger = new Logger(AlbumService.name);

  constructor(private prisma: PrismaService) {}

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
          name: dto.name,
          description: dto.description,
          isPublic: dto.isPublic || false,
        },
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
        albumImages: {
          include: {
            image: true,
          },
          orderBy: {
            order: 'asc',
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

    const images = album.albumImages.map((ai) => ({
      id: ai.image.id,
      originalName: ai.image.originalName,
      format: ai.image.format,
      width: ai.image.width,
      height: ai.image.height,
      size: ai.image.size,
      createdAt: ai.image.createdAt,
      url: `/v2/images/${ai.image.id}`,
      thumbnailUrl: `/v2/images/${ai.image.id}/thumb`,
      order: ai.order,
    }));

    return {
      ...this.formatAlbumResponse(album),
      images,
      imageCount: images.length,
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
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return albums.map((album) => ({
      ...this.formatAlbumResponse(album),
      imageCount: album._count.albumImages,
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
          name: dto.name,
          description: dto.description,
          isPublic: dto.isPublic,
        },
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

      this.logger.log(`[deleteAlbum] Success - Album ID: ${albumId}`);
      return { success: true, message: 'Album deleted successfully' };
    } catch (error) {
      this.logger.error(`[deleteAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
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

      this.logger.log(
        `[addImagesToAlbum] Success - Album ID: ${albumId}, Added: ${albumImages.length}`
      );

      return {
        albumId,
        imageCount: album.albumImages.length + albumImages.length,
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

    // Get album with images
    const album = await this.prisma.album.findUnique({
      where: { id: tokenRecord.albumId },
      include: {
        albumImages: {
          include: {
            image: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    const images = album.albumImages.map((ai) => ({
      id: ai.image.id,
      originalName: ai.image.originalName,
      format: ai.image.format,
      width: ai.image.width,
      height: ai.image.height,
      size: ai.image.size,
      createdAt: ai.image.createdAt,
      url: `/v2/images/${ai.image.id}`,
      thumbnailUrl: `/v2/images/${ai.image.id}/thumb`,
      order: ai.order,
    }));

    return {
      ...this.formatAlbumResponse(album),
      images,
      imageCount: images.length,
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
   * Format album response
   */
  private formatAlbumResponse(album: any) {
    return {
      id: album.id,
      clientId: album.clientId,
      userId: album.userId,
      name: album.name,
      description: album.description,
      isPublic: album.isPublic,
      createdAt: album.createdAt,
    };
  }
}

