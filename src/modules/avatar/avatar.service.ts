import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { WebhookService, WebhookEvent } from '@/modules/webhook/webhook.service';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import { AvatarResponseDto, DeleteAvatarResponseDto } from './dto';

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
  ) {
    // Original should be high quality to preserve avatar fidelity
    this.originalQuality = parseInt(this.config.get('ORIGINAL_QUALITY') || '100');
    // Thumbnail can use lower quality to reduce file size
    this.thumbnailQuality = parseInt(this.config.get('THUMBNAIL_QUALITY') || '70');
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Upload or update avatar for user
   * Se non esiste lo user associato a clientId+externalUserId, lo crea automaticamente.
   */
  async uploadAvatar(
    clientId: string,
    file: Express.Multer.File,
    externalUserId: string,
  ) {
    this.logger.debug(
      `[uploadAvatar] Start - Client: ${clientId}, User: ${externalUserId}, File: ${file.originalname} (${file.size} bytes)`
    );

    try {
      // Validate file
      if (!file.mimetype.startsWith('image/')) {
        this.logger.warn(
          `[uploadAvatar] Invalid MIME type - Client: ${clientId}, User: ${externalUserId}, Type: ${file.mimetype}`
        );
        throw new BadRequestException('Only image files are allowed');
      }
      if (!externalUserId) {
        throw new BadRequestException('externalUserId is required');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client) {
        this.logger.error(`[uploadAvatar] Client not found - Client: ${clientId}`);
        throw new BadRequestException('Client not found');
      }
      const domain = client.domain || clientId;

      // Trova o crea lo user associato a questo externalUserId
      let user = await this.prisma.user.findUnique({
        where: {
          clientId_externalUserId: {
            clientId,
            externalUserId,
          },
        },
      });
      if (!user) {
        this.logger.debug(`[uploadAvatar] Creating new user - Client: ${clientId}, User: ${externalUserId}`);
        user = await this.prisma.user.create({
          data: {
            clientId,
            externalUserId,
            username: 'User',
          },
        });
      }
      const userId = user.id;

      // Check for existing avatar
      const existingAvatar = await this.prisma.avatar.findUnique({
        where: {
          clientId_userId: {
            clientId,
            userId,
          },
        },
      });

      // Delete old avatar files if exists
      if (existingAvatar) {
        this.logger.debug(`[uploadAvatar] Deleting old avatar - Client: ${clientId}, User: ${userId}`);
        const oldAvatarPath = this.storage.getAvatarPath(domain, userId);
        await this.storage.deleteDirectory(oldAvatarPath);
      }

      const avatarId = existingAvatar?.id || uuidv4();
      const avatarPath = this.storage.getAvatarPath(domain, userId);

      // Get metadata
      this.logger.debug(`[uploadAvatar] Extracting metadata - Client: ${clientId}`);
      const metadata = await this.storage.getImageMetadata(file.buffer);
      this.logger.debug(
        `[uploadAvatar] Metadata extracted - Client: ${clientId}, Dimensions: ${metadata.width}x${metadata.height}`
      );

      // Convert to WebP for original (high quality)
      this.logger.debug(`[uploadAvatar] Converting to WebP - Client: ${clientId}, Quality: ${this.originalQuality}`);
      const webpBuffer = await this.storage.convertToWebP(
        file.buffer,
        this.originalQuality,
      );

      // Save original avatar (renamed to original.webp for consistency)
      this.logger.debug(`[uploadAvatar] Saving original - Client: ${clientId}, Size: ${webpBuffer.length} bytes`);
      const originalPath = this.storage.getAvatarFilePath(domain, userId, 'original');
      await this.storage.saveFile(originalPath, webpBuffer);

      // Create and save thumbnail (lower quality for smaller size)
      this.logger.debug(`[uploadAvatar] Creating thumbnail - Client: ${clientId}, Size: ${this.thumbnailSize}, Quality: ${this.thumbnailQuality}`);
      const thumbBuffer = await this.storage.createThumbnail(
        webpBuffer,
        this.thumbnailSize,
        this.thumbnailQuality,
      );
      const thumbnailPath = this.storage.getAvatarFilePath(domain, userId, 'thumb');
      await this.storage.saveFile(thumbnailPath, thumbBuffer);
      this.logger.debug(`[uploadAvatar] Thumbnail saved - Client: ${clientId}, Size: ${thumbBuffer.length} bytes`);

      // Save/Update in database (storagePath is the base path without extension)
      this.logger.debug(`[uploadAvatar] Saving to database - Client: ${clientId}, User: ${userId}`);
      const avatar = await this.prisma.avatar.upsert({
        where: {
          clientId_userId: {
            clientId,
            userId,
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
          userId,
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
      this.webhook.sendWebhook(clientId, WebhookEvent.AVATAR_UPLOADED, {
        avatarId: avatar.id,
        userId: externalUserId,
        width: avatar.width,
        height: avatar.height,
        size: avatar.size,
      }).catch((error) => {
        this.logger.warn(
          `[uploadAvatar] Failed to send webhook for avatar ${avatar.id}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(
        `[uploadAvatar] Success - Client: ${clientId}, User: ${externalUserId}, Size: ${webpBuffer.length} bytes`
      );
      return this.formatAvatarResponse(avatar, externalUserId);
    } catch (error) {
      this.logger.error(
        `[uploadAvatar] Failed - Client: ${clientId}, User: ${externalUserId}, Error: ${error.message}`
      );
      throw error;
    }
  }


  /**
   * Get avatar file by external user ID (used by public endpoint)
   */
  async getAvatarFile(
    externalUserId: string,
    thumbnail: boolean = false,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    // Find user by externalUserId across all clients
    // (public endpoint doesn't have clientId context)
    const user = await this.prisma.user.findFirst({
      where: { externalUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.prisma.avatar.findFirst({
      where: { userId: user.id },
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
    const filePath = this.storage.getAvatarFilePath(domain, user.id, variant as 'original' | 'thumb');

    const buffer = await this.storage.readFile(filePath);
    return { buffer, mimeType: avatar.mimeType };
  }

  /**
   * Delete user avatar by external user ID
   */
  async deleteAvatar(clientId: string, externalUserId: string): Promise<DeleteAvatarResponseDto> {
    this.logger.debug(`[deleteAvatar] Start - Client: ${clientId}, User: ${externalUserId}`);

    try {
      // Find the user by clientId and externalUserId
      const user = await this.prisma.user.findUnique({
        where: {
          clientId_externalUserId: {
            clientId,
            externalUserId,
          },
        },
      });

      if (!user) {
        this.logger.warn(`[deleteAvatar] User not found - Client: ${clientId}, User: ${externalUserId}`);
        throw new NotFoundException('User not found');
      }

      // Verify avatar exists
      const avatar = await this.prisma.avatar.findUnique({
        where: {
          clientId_userId: {
            clientId,
            userId: user.id,
          },
        },
      });

      if (!avatar) {
        this.logger.warn(`[deleteAvatar] Avatar not found - Client: ${clientId}, User: ${externalUserId}`);
        throw new NotFoundException('Avatar not found');
      }

      // Get client to retrieve domain
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
      });
      const domain = client?.domain || clientId;

      // Delete files
      this.logger.debug(`[deleteAvatar] Deleting files - Client: ${clientId}, User: ${user.id}`);
      const avatarPath = this.storage.getAvatarPath(domain, user.id);
      await this.storage.deleteDirectory(avatarPath);

      // Delete from database
      this.logger.debug(`[deleteAvatar] Deleting from database - Client: ${clientId}, User: ${user.id}`);
      await this.prisma.avatar.delete({
        where: {
          clientId_userId: {
            clientId,
            userId: user.id,
          },
        },
      });

      // Send webhook notification (non-blocking)
      this.webhook.sendWebhook(clientId, WebhookEvent.AVATAR_DELETED, {
        id: avatar.id,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        this.logger.warn(
          `[deleteAvatar] Failed to send webhook for avatar ${avatar.id}:`,
          error instanceof Error ? error.message : error
        );
      });

      this.logger.log(
        `[deleteAvatar] Success - Client: ${clientId}, User: ${externalUserId}, Size: ${avatar.size} bytes`
      );
      return this.formatDeleteResponse('Avatar deleted successfully');
    } catch (error) {
      this.logger.error(
        `[deleteAvatar] Failed - Client: ${clientId}, User: ${externalUserId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Get avatars not optimized
   */
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
   * Get avatar by external user ID (for info endpoint)
   */
  async getAvatarByExternalUserId(externalUserId: string) {
    const user = await this.prisma.user.findFirst({
      where: { externalUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.prisma.avatar.findFirst({
      where: { userId: user.id },
    });

    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return avatar;
  }

  /**
   * Get avatar metadata for info endpoint
   */
  getAvatarMetadata(avatar: any, externalUserId: string): AvatarResponseDto {
    return this.formatAvatarResponse(avatar, externalUserId);
  }

  /**
   * Format avatar response using class-transformer
   */
  private formatAvatarResponse(avatar: any, externalUserId: string): AvatarResponseDto {
    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';

    const url = `/${apiPrefix}/avatars/${externalUserId}`;
    const thumbnailUrl = `/${apiPrefix}/avatars/${externalUserId}?thumb=true`;

    return plainToInstance(
      AvatarResponseDto,
      {
        ...avatar,
        url,
        thumbnailUrl,
        fullPath: `${baseUrl}${url}`
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
