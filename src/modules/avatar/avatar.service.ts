import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import {
  WebhookService,
  WebhookEvent,
} from '@/modules/webhook/webhook.service';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import { AvatarResponseDto, DeleteAvatarResponseDto } from './dto';
import { CreatorService } from '@/modules/creator/creator.service';
import { RouteHelperService } from '@/utils/route.utils';

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly originalQuality: number;
  private readonly thumbnailQuality: number;
  private readonly thumbnailSize: number;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private webhook: WebhookService,
    private creatorService: CreatorService,
    private route: RouteHelperService,
  ) {
    // Original should be high quality to preserve avatar fidelity
    this.originalQuality = parseInt(
      this.config.get('ORIGINAL_QUALITY') || '100',
    );
    // Thumbnail can use lower quality to reduce file size
    this.thumbnailQuality = parseInt(
      this.config.get('THUMBNAIL_QUALITY') || '70',
    );
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Upload or update avatar for creator
   * Se non esiste lo creator associato a clientId+externalId, lo crea automaticamente.
   */
  async uploadAvatar(
    clientId: string,
    file: Express.Multer.File,
    externalId: string,
  ) {
    this.logger.debug(
      `[uploadAvatar] Start - Client: ${clientId}, Creator: ${externalId}, File: ${file.originalname} (${file.size} bytes)`,
    );

    try {
      // Validate file
      if (!file.mimetype.startsWith('image/')) {
        this.logger.warn(
          `[uploadAvatar] Invalid MIME type - Client: ${clientId}, Creator: ${externalId}, Type: ${file.mimetype}`,
        );
        throw new BadRequestException('Only image files are allowed');
      }
      if (!externalId) {
        throw new BadRequestException('externalId is required');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client) {
        this.logger.error(
          `[uploadAvatar] Client not found - Client: ${clientId}`,
        );
        throw new BadRequestException('Client not found');
      }
      const domain = client.domain || clientId;

      // Trova o crea lo creator associato a questo externalId
      this.logger.debug(
        `[uploadAvatar] Resolving creator - Client: ${clientId}, Creator: ${externalId}`,
      );
      const creator = await this.creatorService.resolveUser(
        clientId,
        externalId,
      );
      const creatorId = creator.id;

      // Check for existing avatar
      const existingAvatar = await this.prisma.avatar.findUnique({
        where: {
          clientId_creatorId: {
            clientId,
            creatorId,
          },
        },
      });

      // Delete old avatar files if exists
      if (existingAvatar) {
        this.logger.debug(
          `[uploadAvatar] Deleting old avatar - Client: ${clientId}, Creator: ${creatorId}`,
        );
        const oldAvatarPath = this.storage.getAvatarPath(domain, creatorId);
        await this.storage.deleteDirectory(oldAvatarPath);
      }

      const avatarId = existingAvatar?.id || uuidv4();
      const avatarPath = this.storage.getAvatarPath(domain, creatorId);

      // Get metadata
      this.logger.debug(
        `[uploadAvatar] Extracting metadata - Client: ${clientId}`,
      );
      const metadata = await this.storage.getImageMetadata(file.buffer);
      this.logger.debug(
        `[uploadAvatar] Metadata extracted - Client: ${clientId}, Dimensions: ${metadata.width}x${metadata.height}`,
      );

      // Convert to WebP for original (high quality)
      this.logger.debug(
        `[uploadAvatar] Converting to WebP - Client: ${clientId}, Quality: ${this.originalQuality}`,
      );
      const webpBuffer = await this.storage.convertToWebP(
        file.buffer,
        this.originalQuality,
      );

      // Save original avatar (renamed to original.webp for consistency)
      this.logger.debug(
        `[uploadAvatar] Saving original - Client: ${clientId}, Size: ${webpBuffer.length} bytes`,
      );
      const originalPath = this.storage.getAvatarFilePath(
        domain,
        creatorId,
        'original',
      );
      await this.storage.saveFile(originalPath, webpBuffer);

      // Create and save thumbnail (lower quality for smaller size)
      this.logger.debug(
        `[uploadAvatar] Creating thumbnail - Client: ${clientId}, Size: ${this.thumbnailSize}, Quality: ${this.thumbnailQuality}`,
      );
      const thumbBuffer = await this.storage.createThumbnail(
        webpBuffer,
        this.thumbnailSize,
        this.thumbnailQuality,
      );
      const thumbnailPath = this.storage.getAvatarFilePath(
        domain,
        creatorId,
        'thumb',
      );
      await this.storage.saveFile(thumbnailPath, thumbBuffer);
      this.logger.debug(
        `[uploadAvatar] Thumbnail saved - Client: ${clientId}, Size: ${thumbBuffer.length} bytes`,
      );

      // Save/Update in database (storagePath is the base path without extension)
      this.logger.debug(
        `[uploadAvatar] Saving to database - Client: ${clientId}, Creator: ${creatorId}`,
      );
      const avatar = await this.prisma.avatar.upsert({
        where: {
          clientId_creatorId: {
            clientId,
            creatorId,
          },
        },
        update: {
          storagePath: avatarPath,
          format: 'webp',
          width: metadata.width,
          height: metadata.height,
          size: webpBuffer.length,
          mimeType: 'image/webp',
          isOptimized: false,
        },
        create: {
          id: avatarId,
          clientId,
          creatorId,
          storagePath: avatarPath,
          format: 'webp',
          width: metadata.width,
          height: metadata.height,
          size: webpBuffer.length,
          mimeType: 'image/webp',
          isOptimized: false,
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook
        .sendWebhook(clientId, WebhookEvent.AVATAR_UPLOADED, {
          avatarId: avatar.id,
          creatorId: externalId,
          width: avatar.width,
          height: avatar.height,
          size: avatar.size,
        })
        .catch((error) => {
          this.logger.warn(
            `[uploadAvatar] Failed to send webhook for avatar ${avatar.id}:`,
            error instanceof Error ? error.message : error,
          );
        });

      this.logger.log(
        `[uploadAvatar] Success - Client: ${clientId}, Creator: ${externalId}, Size: ${webpBuffer.length} bytes`,
      );
      return this.formatAvatarResponse(avatar, externalId);
    } catch (error) {
      this.logger.error(
        `[uploadAvatar] Failed - Client: ${clientId}, Creator: ${externalId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get avatar file by external creator ID (used by public endpoint)
   */
  async getAvatarFile(
    externalId: string,
    thumbnail: boolean = false,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    // Find creator by externalId across all clients
    // (public endpoint doesn't have clientId context)
    const creator = await this.prisma.creator.findFirst({
      where: { externalId },
    });

    if (!creator) {
      throw new NotFoundException('Creator not found');
    }

    const avatar = await this.prisma.avatar.findFirst({
      where: { creatorId: creator.id },
    });

    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: avatar.clientId },
    });
    const domain = client?.domain || avatar.clientId;

    // Get the appropriate variant path
    const variant = thumbnail ? 'thumb' : 'original';
    const filePath = this.storage.getAvatarFilePath(
      domain,
      creator.id,
      variant as 'original' | 'thumb',
    );

    const buffer = await this.storage.readFile(filePath);
    return { buffer, mimeType: avatar.mimeType };
  }

  /**
   * Delete creator avatar by external creator ID
   */
  async deleteAvatar(
    clientId: string,
    externalId: string,
  ): Promise<DeleteAvatarResponseDto> {
    this.logger.debug(
      `[deleteAvatar] Start - Client: ${clientId}, Creator: ${externalId}`,
    );

    try {
      // Find the creator by clientId and externalId
      const creator = await this.prisma.creator.findUnique({
        where: {
          clientId_externalId: {
            clientId,
            externalId,
          },
        },
      });

      if (!creator) {
        this.logger.warn(
          `[deleteAvatar] Creator not found - Client: ${clientId}, Creator: ${externalId}`,
        );
        throw new NotFoundException('Creator not found');
      }

      // Verify avatar exists
      const avatar = await this.prisma.avatar.findUnique({
        where: {
          clientId_creatorId: {
            clientId,
            creatorId: creator.id,
          },
        },
      });

      if (!avatar) {
        this.logger.warn(
          `[deleteAvatar] Avatar not found - Client: ${clientId}, Creator: ${externalId}`,
        );
        throw new NotFoundException('Avatar not found');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      const domain = client?.domain || clientId;

      // Delete files
      this.logger.debug(
        `[deleteAvatar] Deleting files - Client: ${clientId}, Creator: ${creator.id}`,
      );
      const avatarPath = this.storage.getAvatarPath(domain, creator.id);
      await this.storage.deleteDirectory(avatarPath);

      // Delete from database
      this.logger.debug(
        `[deleteAvatar] Deleting from database - Client: ${clientId}, Creator: ${creator.id}`,
      );
      await this.prisma.avatar.delete({
        where: {
          clientId_creatorId: {
            clientId,
            creatorId: creator.id,
          },
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook
        .sendWebhook(clientId, WebhookEvent.AVATAR_DELETED, {
          id: avatar.id,
          timestamp: new Date().toISOString(),
        })
        .catch((error) => {
          this.logger.warn(
            `[deleteAvatar] Failed to send webhook for avatar ${avatar.id}:`,
            error instanceof Error ? error.message : error,
          );
        });

      this.logger.log(
        `[deleteAvatar] Success - Client: ${clientId}, Creator: ${externalId}, Size: ${avatar.size} bytes`,
      );
      return this.formatDeleteResponse('Avatar deleted successfully');
    } catch (error) {
      this.logger.error(
        `[deleteAvatar] Failed - Client: ${clientId}, Creator: ${externalId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Admin paginated avatar listing — accepts a pre-built Prisma where clause
   * and adds admin-specific includes (creator, client join).
   * The caller is responsible for computing skip and take.
   */
  async findAdminAvatars(where: any, options: { skip: number; take: number }) {
    const [avatars, total] = await Promise.all([
      this.prisma.avatar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
        include: {
          creator: { select: { externalId: true, username: true } },
          client: { select: { name: true, domain: true } },
        },
      }),
      this.prisma.avatar.count({ where }),
    ]);

    return { avatars, total };
  }

  /**
   * Get avatar by internal ID with creator join (admin use).
   * Returns null if not found.
   */
  async getAvatarById(avatarId: string) {
    return this.prisma.avatar.findUnique({
      where: { id: avatarId },
      include: {
        client: { select: { id: true, name: true, domain: true } },
        creator: { select: { externalId: true, username: true } },
      },
    });
  }

  /**
   * Get avatars not optimized
   */
  /**
   * Delete avatar by its internal ID (admin use — bypasses externalId lookup).
   */
  async deleteAvatarById(
    avatarId: string,
    clientId: string,
  ): Promise<DeleteAvatarResponseDto> {
    const avatar = await this.prisma.avatar.findFirst({
      where: { id: avatarId, clientId },
      include: { creator: { select: { externalId: true } } },
    });

    if (!avatar) throw new NotFoundException('Avatar not found');

    const externalId = avatar.creator?.externalId;
    if (!externalId)
      throw new NotFoundException('Creator not found for avatar');

    return this.deleteAvatar(clientId, externalId);
  }

  async getUnoptimizedAvatars() {
    return this.prisma.avatar.findMany({
      where: {
        isOptimized: false,
      },
      take: 50,
    });
  }

  /**
   * Mark avatar as optimized
   */
  async markAsOptimized(avatarId: string) {
    return this.prisma.avatar.update({
      where: { id: avatarId },
      data: {
        isOptimized: true,
        optimizedAt: new Date(),
      },
    });
  }

  /**
   * Get avatar by external creator ID (for info endpoint)
   */
  async getAvatarByExternalId(externalId: string) {
    const creator = await this.prisma.creator.findFirst({
      where: { externalId },
    });

    if (!creator) {
      throw new NotFoundException('Creator not found');
    }

    const avatar = await this.prisma.avatar.findFirst({
      where: { creatorId: creator.id },
    });

    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return avatar;
  }

  /**
   * Get avatar metadata for info endpoint
   */
  getAvatarMetadata(avatar: any, externalId: string): AvatarResponseDto {
    return this.formatAvatarResponse(avatar, externalId);
  }

  /**
   * Format avatar response using class-transformer
   */
  private formatAvatarResponse(
    avatar: any,
    externalId: string,
  ): AvatarResponseDto {
    const url = this.route.path('avatars', externalId);
    const thumbnailUrl = this.route.path('avatars', externalId) + '?thumb=true';

    return plainToInstance(
      AvatarResponseDto,
      {
        ...avatar,
        url,
        thumbnailUrl,
        fullPath: this.route.fullUrl('avatars', externalId),
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Format delete response using class-transformer
   */
  private formatDeleteResponse(message: string): DeleteAvatarResponseDto {
    return plainToInstance(
      DeleteAvatarResponseDto,
      { success: true, message },
      { excludeExtraneousValues: true },
    );
  }
}
