import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
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
    // Validate file
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new BadRequestException('Client not found');
    }
    const domain = client.domain || clientId;

    // Trova o crea lo user associato
    // If no externalUserId provided, generate an auto ID
    let extUserId = externalUserId;
    if (!extUserId) {
      extUserId = 'auto-' + uuidv4();
    }
    let user = await this.prisma.user.findUnique({
      where: {
        clientId_externalUserId: {
          clientId,
          externalUserId: extUserId,
        },
      },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          clientId,
          externalUserId: extUserId,
          username: 'AutoUser',
        },
      });
    }
    const userId = user.id;

    const imageId = uuidv4();
    const imagePath = this.storage.getImagePath(domain, imageId);

    // Get metadata
    const metadata = await this.storage.getImageMetadata(file.buffer);

    // Convert to WebP
    const webpBuffer = await this.storage.convertToWebP(
      file.buffer,
      this.webpQuality,
    );

    // Save original
    const originalPath = path.join(imagePath, 'original.webp');
    await this.storage.saveFile(originalPath, webpBuffer);

    // Create thumbnail
    const thumbBuffer = await this.storage.createThumbnail(
      webpBuffer,
      this.thumbnailSize,
      this.webpQuality,
    );
    const thumbnailPath = path.join(imagePath, 'thumb.webp');
    await this.storage.saveFile(thumbnailPath, thumbBuffer);

    // Save to database
    const image = await this.prisma.image.create({
      data: {
        id: imageId,
        clientId,
        userId,
        originalName: file.originalname,
        storagePath: originalPath,
        thumbnailPath,
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
      await this.addImageToAlbum(imageId, albumId, clientId);
    }

    return this.formatImageResponse(image);
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

    // If thumbnail explicitly requested
    if (thumb && image.thumbnailPath && (await this.storage.fileExists(image.thumbnailPath))) {
      const buffer = await this.storage.readFile(image.thumbnailPath);
      return { buffer, mimeType: 'image/webp' };
    }

    // Check if thumbnail is requested implicitly (no dimensions and default format)
    if (
      !thumb &&
      !width &&
      !height &&
      format === 'webp' &&
      image.thumbnailPath &&
      (await this.storage.fileExists(image.thumbnailPath))
    ) {
      const buffer = await this.storage.readFile(image.thumbnailPath);
      return { buffer, mimeType: 'image/webp' };
    }

    // Load original
    const originalBuffer = await this.storage.readFile(image.storagePath);

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

    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    const domain = client?.domain || clientId;

    // Delete files
    const imagePath = this.storage.getImagePath(domain, imageId);
    await this.storage.deleteDirectory(imagePath);

    // Delete from database
    await this.prisma.image.delete({
      where: { id: imageId },
    });

    return this.formatDeleteResponse('Image deleted successfully');
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

    const updatedImage = await this.prisma.image.update({
      where: { id: imageId },
      data: {
        ...(tags !== undefined && { tags }),
        ...(description !== undefined && { description }),
      },
    });

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

    const readToken = uuidv4();

    const shareLink = await this.prisma.imageShareLink.create({
      data: {
        imageId,
        readToken,
        expiresAt: expiresAt || null,
      },
    });

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
    const shareLink = await this.prisma.imageShareLink.findUnique({
      where: { id: shareLinkId },
      include: { image: true },
    });

    if (!shareLink) {
      throw new NotFoundException('Share link not found');
    }

    if (shareLink.image.clientId !== clientId || shareLink.image.userId !== userId) {
      throw new NotFoundException('Share link not found');
    }

    await this.prisma.imageShareLink.delete({
      where: { id: shareLinkId },
    });

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
        thumbnailUrl: image.thumbnailPath ? `/${apiPrefix}/images/${image.id}?thumb=true` : undefined,
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
