import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import {
  ImageResponseDto,
  ShareLinkResponseDto,
  DeleteResponseDto,
  ListImagesResponseDto,
  PaginationMetaDto,
} from './dto';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  private readonly webpQuality: number;
  private readonly thumbnailSize: number;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
  ) {
    this.webpQuality = parseInt(this.config.get('WEBP_QUALITY') || '85');
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Upload image
   */
  async uploadImage(
    clientId: string,
    externalUserId: string | undefined,
    file: Express.Multer.File,
    albumId?: string,
    tags?: string[],
    description?: string,
    isPrivate?: boolean,
  ) {
    const imageId = uuidv4();
    this.logger.debug(
      `[uploadImage] Start - ID: ${imageId}, Client: ${clientId}, User: ${externalUserId || 'system'}, File: ${file.originalname}, Size: ${file.size}, Type: ${file.mimetype}`
    );

    try {
      // Validate file
      if (!file.mimetype.startsWith('image/')) {
        this.logger.warn(
          `[uploadImage] Invalid MIME type - ID: ${imageId}, Client: ${clientId}, Type: ${file.mimetype}`
        );
        throw new BadRequestException('Only image files are allowed');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client) {
        this.logger.error(`[uploadImage] Client not found - ID: ${imageId}, Client: ${clientId}`);
        throw new BadRequestException('Client not found');
      }
      const domain = client.domain || clientId;

      // Get or create user
      let user;
      if (externalUserId) {
        // If externalUserId is provided, get or create that user
        user = await this.prisma.user.findUnique({
          where: {
            clientId_externalUserId: {
              clientId,
              externalUserId,
            },
          },
        });
        if (!user) {
          this.logger.debug(`[uploadImage] Creating new user - ID: ${imageId}, External: ${externalUserId}`);
          user = await this.prisma.user.create({
            data: {
              clientId,
              externalUserId,
            },
          });
        }
      } else {
        // If no externalUserId, use the system user
        user = await this.prisma.user.findUnique({
          where: {
            clientId_externalUserId: {
              clientId,
              externalUserId: 'system',
            },
          },
        });
        if (!user) {
          this.logger.error(`[uploadImage] System user not found - ID: ${imageId}, Client: ${clientId}`);
          throw new BadRequestException('System user not found for client');
        }
      }
      const userId = user.id;

      const imagePath = this.storage.getImagePath(domain, imageId);

      // Get metadata
      this.logger.debug(`[uploadImage] Extracting metadata - ID: ${imageId}`);
      const metadata = await this.storage.getImageMetadata(file.buffer);
      this.logger.debug(
        `[uploadImage] Metadata extracted - ID: ${imageId}, Dimensions: ${metadata.width}x${metadata.height}`
      );

      // Convert to WebP
      this.logger.debug(`[uploadImage] Converting to WebP - ID: ${imageId}, Quality: ${this.webpQuality}`);
      const webpBuffer = await this.storage.convertToWebP(
        file.buffer,
        this.webpQuality,
      );

      // Save original
      this.logger.debug(`[uploadImage] Saving original - ID: ${imageId}, Size: ${webpBuffer.length} bytes`);
      const originalPath = this.storage.getImageFilePath(domain, imageId, 'original');
      await this.storage.saveFile(originalPath, webpBuffer);

      // Create thumbnail
      this.logger.debug(`[uploadImage] Creating thumbnail - ID: ${imageId}, Size: ${this.thumbnailSize}`);
      const thumbBuffer = await this.storage.createThumbnail(
        webpBuffer,
        this.thumbnailSize,
        this.webpQuality,
      );
      const thumbnailPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
      await this.storage.saveFile(thumbnailPath, thumbBuffer);
      this.logger.debug(`[uploadImage] Thumbnail saved - ID: ${imageId}, Size: ${thumbBuffer.length} bytes`);

      // Save to database (storagePath is the base path without extension)
      this.logger.debug(
        `[uploadImage] Saving to database - ID: ${imageId}, Tags: ${tags?.length || 0}, Private: ${isPrivate}`
      );
      const image = await this.prisma.image.create({
        data: {
          id: imageId,
          clientId,
          userId,
          originalName: file.originalname,
          storagePath: imagePath,
          format: 'webp',
          width: metadata.width,
          height: metadata.height,
          size: webpBuffer.length,
          mimeType: 'image/webp',
          isOptimized: false,
          isPrivate: isPrivate || false,
          tags: tags || [],
          description: description || null,
        },
      });

      // Add to album if specified
      if (albumId) {
        this.logger.debug(`[uploadImage] Adding to album - ID: ${imageId}, Album: ${albumId}`);
        await this.addImageToAlbum(imageId, albumId, clientId);
      }

      this.logger.log(
        `[uploadImage] Success - ID: ${imageId}, Client: ${clientId}, User: ${userId}, Size: ${webpBuffer.length}`
      );
      return this.formatImageResponse(image);
    } catch (error) {
      this.logger.error(
        `[uploadImage] Failed - ID: ${imageId}, Client: ${clientId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get image by ID
   */
  async getImageById(imageId: string, clientId?: string) {
    const where: any = { id: imageId };
    if (clientId) {
      where.clientId = clientId;
    }

    const image = await this.prisma.image.findFirst({ where });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    return image;
  }

  /**
   * Get image file
   */
  async getImageFile(
    imageId: string,
    width?: number,
    height?: number,
    format: 'webp' | 'jpeg' | 'png' = 'webp',
    quality: number = 85,
    thumb: boolean = false,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const image = await this.getImageById(imageId);

    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: image.clientId },
    });
    const domain = client?.domain || image.clientId;

    // If thumbnail explicitly requested
    if (thumb) {
      const thumbPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
      if (await this.storage.fileExists(thumbPath)) {
        const buffer = await this.storage.readFile(thumbPath);
        return { buffer, mimeType: 'image/webp' };
      }
    }

    // Check if thumbnail is requested implicitly (no dimensions and default format)
    if (!thumb && !width && !height && format === 'webp') {
      const thumbPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
      if (await this.storage.fileExists(thumbPath)) {
        const buffer = await this.storage.readFile(thumbPath);
        return { buffer, mimeType: 'image/webp' };
      }
    }

    // Load original
    const originalPath = this.storage.getImageFilePath(domain, imageId, 'original');
    const originalBuffer = await this.storage.readFile(originalPath);

    // If no resize needed and format matches
    if (!width && !height && format === 'webp') {
      return { buffer: originalBuffer, mimeType: 'image/webp' };
    }

    // Resize on-demand
    const resizedBuffer = await this.storage.resizeImage(
      originalBuffer,
      width,
      height,
      format,
      quality,
    );

    const mimeType = `image/${format}`;
    return { buffer: resizedBuffer, mimeType };
  }

  /**
   * Get user images
   */
  async getUserImages(clientId: string, userId: string) {
    const images = await this.prisma.image.findMany({
      where: {
        clientId,
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return images.map((img) => this.formatImageResponse(img));
  }

  /**
   * List images with filtering
   */
  async listImages(filters: {
    clientId?: string;
    userId?: string;
    page?: number;
    perPage?: number;
  }): Promise<ListImagesResponseDto> {
    const page = filters.page || 1;
    const perPage = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * perPage;

    const where: { clientId?: string; userId?: string } = {};
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    if (filters.userId) {
      where.userId = filters.userId;
    }

    const [images, total] = await Promise.all([
      this.prisma.image.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: perPage,
        include: {
          user: {
            select: {
              id: true,
              externalUserId: true,
              username: true,
            }
          },
          client: {
            select: {
              id: true,
              name: true,
              domain: true,
            }
          },
        }
      }),
      this.prisma.image.count({ where }),
    ]);

    const data = images.map((img) => this.formatImageResponse(img));
    const pagination = plainToInstance(
      PaginationMetaDto,
      {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
      { excludeExtraneousValues: true },
    );

    return plainToInstance(
      ListImagesResponseDto,
      { data, pagination },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Delete image
   */
  async deleteImage(imageId: string, clientId: string, userId: string): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[deleteImage] Start - ID: ${imageId}, Client: ${clientId}, User: ${userId}`
    );

    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        clientId,
        userId,
      },
    });

    if (!image) {
      this.logger.warn(
        `[deleteImage] Image not found - ID: ${imageId}, Client: ${clientId}, User: ${userId}`
      );
      throw new NotFoundException('Image not found');
    }

    try {
      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      const domain = client?.domain || clientId;

      // Delete files
      const imagePath = this.storage.getImagePath(domain, imageId);
      this.logger.debug(`[deleteImage] Deleting files - ID: ${imageId}, Path: ${imagePath}`);
      await this.storage.deleteDirectory(imagePath);

      // Delete from database
      this.logger.debug(`[deleteImage] Deleting from database - ID: ${imageId}`);
      await this.prisma.image.delete({
        where: { id: imageId },
      });

      this.logger.log(
        `[deleteImage] Success - ID: ${imageId}, Client: ${clientId}, Size: ${image.size} bytes`
      );
      return this.formatDeleteResponse('Image deleted successfully');
    } catch (error) {
      this.logger.error(
        `[deleteImage] Failed - ID: ${imageId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Add image to album
   */
  async addImageToAlbum(imageId: string, albumId: string, clientId: string) {
    // Verify image and album belong to same client
    await this.getImageById(imageId, clientId); // Only for validation, no need to assign
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, clientId },
    });

    if (!album) {
      throw new NotFoundException('Album not found');
    }

    // Get max order
    const maxOrder = await this.prisma.albumImage.findFirst({
      where: { albumId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return this.prisma.albumImage.create({
      data: {
        albumId,
        imageId,
        order: (maxOrder?.order || 0) + 1,
      },
    });
  }

  /**
   * Get images not optimized
   */
  async getUnoptimizedImages() {
    return this.prisma.image.findMany({
      where: {
        isOptimized: false,
      },
      take: 50, // Process in batches
    });
  }

  /**
   * Mark image as optimized
   */
  async markAsOptimized(imageId: string) {
    return this.prisma.image.update({
      where: { id: imageId },
      data: {
        isOptimized: true,
        optimizedAt: new Date(),
      },
    });
  }

  /**
   * Update image metadata
   */
  async updateImageMetadata(
    imageId: string,
    clientId: string,
    userId: string,
    tags?: string[],
    description?: string,
  ) {
    this.logger.debug(
      `[updateImageMetadata] Start - ID: ${imageId}, Client: ${clientId}, User: ${userId}, Tags: ${tags?.length || 0}`
    );

    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        clientId,
        userId,
      },
    });

    if (!image) {
      this.logger.warn(
        `[updateImageMetadata] Image not found - ID: ${imageId}, Client: ${clientId}, User: ${userId}`
      );
      throw new NotFoundException('Image not found');
    }

    const updatedImage = await this.prisma.image.update({
      where: { id: imageId },
      data: {
        ...(tags !== undefined && { tags }),
        ...(description !== undefined && { description }),
      },
    });

    this.logger.log(`[updateImageMetadata] Success - ID: ${imageId}, Client: ${clientId}`);
    return this.formatImageResponse(updatedImage);
  }

  /**
   * Increment views counter
   */
  async incrementViews(imageId: string) {
    await this.prisma.image.update({
      where: { id: imageId },
      data: {
        views: { increment: 1 },
      },
    });
  }

  /**
   * Increment downloads counter
   */
  async incrementDownloads(imageId: string, clientId: string) {
    const image = await this.getImageById(imageId, clientId);

    await this.prisma.image.update({
      where: { id: imageId },
      data: {
        downloads: { increment: 1 },
      },
    });
  }

  /**
   * Create share link for image
   */
  async createShareLink(
    imageId: string,
    clientId: string,
    userId: string,
    expiresAt?: Date,
  ): Promise<ShareLinkResponseDto> {
    this.logger.debug(
      `[createShareLink] Start - ID: ${imageId}, Client: ${clientId}, User: ${userId}, Expires: ${expiresAt?.toISOString() || 'never'}`
    );

    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        clientId,
        userId,
      },
    });

    if (!image) {
      this.logger.warn(
        `[createShareLink] Image not found - ID: ${imageId}, Client: ${clientId}, User: ${userId}`
      );
      throw new NotFoundException('Image not found');
    }

    const readToken = uuidv4();

    const shareLink = await this.prisma.imageShareLink.create({
      data: {
        imageId,
        readToken,
        expiresAt: expiresAt || null,
      },
    });

    this.logger.log(
      `[createShareLink] Success - ID: ${imageId}, Token: ${readToken}, Expires: ${expiresAt?.toISOString() || 'never'}`
    );
    return this.formatShareLinkResponse(shareLink);
  }

  /**
   * Get share links for an image
   */
  async getShareLinks(imageId: string, clientId: string, userId: string): Promise<ShareLinkResponseDto[]> {
    const image = await this.prisma.image.findFirst({
      where: {
        id: imageId,
        clientId,
        userId,
      },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    const shareLinks = await this.prisma.imageShareLink.findMany({
      where: { imageId },
      orderBy: { createdAt: 'desc' },
    });

    return shareLinks.map((link) => this.formatShareLinkResponse(link));
  }

  /**
   * Delete share link
   */
  async deleteShareLink(
    shareLinkId: string,
    clientId: string,
    userId: string,
  ): Promise<DeleteResponseDto> {
    this.logger.debug(
      `[deleteShareLink] Start - LinkID: ${shareLinkId}, Client: ${clientId}, User: ${userId}`
    );

    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { id: shareLinkId },
      include: { image: true },
    });

    if (!shareLink) {
      this.logger.warn(
        `[deleteShareLink] Share link not found - LinkID: ${shareLinkId}, Client: ${clientId}`
      );
      throw new NotFoundException('Share link not found');
    }

    if (shareLink.image.clientId !== clientId || shareLink.image.userId !== userId) {
      this.logger.warn(
        `[deleteShareLink] Access denied - LinkID: ${shareLinkId}, Client: ${clientId}, User: ${userId}, ImageClient: ${shareLink.image.clientId}`
      );
      throw new NotFoundException('Share link not found');
    }

    await this.prisma.imageShareLink.delete({
      where: { id: shareLinkId },
    });

    this.logger.log(`[deleteShareLink] Success - LinkID: ${shareLinkId}, ImageID: ${shareLink.imageId}`);
    return this.formatDeleteResponse('Share link deleted successfully');
  }

  /**
   * Get image by share token
   */
  async getImageByShareToken(readToken: string) {
    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { readToken },
      include: { image: true },
    });

    if (!shareLink) {
      throw new NotFoundException('Share link not found');
    }

    // Check if link has expired
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      throw new BadRequestException('Share link has expired');
    }

    return shareLink.image;
  }

  /**
   * Check if user has access to image (for private images)
   */
  async checkImageAccess(
    imageId: string,
    clientId: string,
    userId?: string,
    shareToken?: string,
  ): Promise<boolean> {
    const image = await this.getImageById(imageId);

    // If image is not private, everyone has access
    if (!image.isPrivate) {
      return true;
    }

    // Check if user owns the image
    if (userId && image.userId === userId && image.clientId === clientId) {
      return true;
    }

    // Check if valid share token is provided
    if (shareToken) {
      const shareLink = await this.prisma.imageShareLink.findUnique({
        where: { readToken: shareToken },
      });

      if (shareLink && shareLink.imageId === imageId) {
        // Check if link has not expired
        if (!shareLink.expiresAt || shareLink.expiresAt > new Date()) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validate that userId is present
   * @throws BadRequestException if userId is missing
   */
  validateUserId(userId: string | undefined): string {
    if (!userId) {
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
    return userId;
  }

  /**
   * Validate image access for private images
   * @throws ForbiddenException if access is denied
   */
  async validateImageAccess(
    image: any,
    imageId: string,
    clientId: string | undefined,
    userId: string | undefined,
    token?: string,
  ): Promise<void> {
    if (!image.isPrivate) {
      return;
    }

    if (!clientId) {
      throw new ForbiddenException('This image is private. Authentication required.');
    }

    const hasAccess = await this.checkImageAccess(
      imageId,
      clientId,
      userId,
      token,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        token ? 'Invalid token or access denied.' : 'You do not have access to this private image.',
      );
    }
  }

  /**
   * Get image metadata for info endpoint
   */
  async getImageMetadata(image: any): Promise<ImageResponseDto> {
    return this.formatImageResponse(image);
  }

  /**
   * Format image response using class-transformer
   */
  private formatImageResponse(image: any): ImageResponseDto {
    const apiPrefix = this.config.get('API_PREFIX') || 'v2';

    return plainToInstance(
      ImageResponseDto,
      {
        ...image,
        url: `/${apiPrefix}/images/${image.id}`,
        thumbnailUrl: `/${apiPrefix}/images/${image.id}?thumb=true`,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Format share link response using class-transformer
   */
  private formatShareLinkResponse(shareLink: any): ShareLinkResponseDto {
    const apiPrefix = this.config.get('API_PREFIX') || 'v2';

    return plainToInstance(
      ShareLinkResponseDto,
      {
        ...shareLink,
        shareUrl: `/${apiPrefix}/images/shared/${shareLink.readToken}`,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Format delete response using class-transformer
   */
  private formatDeleteResponse(message: string): DeleteResponseDto {
    return plainToInstance(
      DeleteResponseDto,
      { success: true, message },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Delete expired share links
   */
  async deleteExpiredShareLinks(): Promise<number> {
    const result = await this.prisma.imageShareLink.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return result.count;
  }
}
