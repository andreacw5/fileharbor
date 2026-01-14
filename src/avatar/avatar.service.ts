import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import * as path from 'path';
import { AvatarResponseDto, DeleteAvatarResponseDto } from './dto';

@Injectable()
export class AvatarService {
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
   * Upload or update avatar for user
   * Se non esiste lo user associato a clientId+externalUserId, lo crea automaticamente.
   */
  async uploadAvatar(
    clientId: string,
    file: Express.Multer.File,
    externalUserId: string,
  ) {
    // Validate file
    if (!file.mimetype.startsWith('image/')) {
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
      const oldAvatarPath = this.storage.getAvatarPath(domain, userId);
      await this.storage.deleteDirectory(oldAvatarPath);
    }

    const avatarId = existingAvatar?.id || uuidv4();
    const avatarPath = this.storage.getAvatarPath(domain, userId);

    // Get metadata
    const metadata = await this.storage.getImageMetadata(file.buffer);

    // Convert to WebP
    const webpBuffer = await this.storage.convertToWebP(
      file.buffer,
      this.webpQuality,
    );

    // Save avatar
    const storagePath = path.join(avatarPath, 'avatar.webp');
    await this.storage.saveFile(storagePath, webpBuffer);

    // Create thumbnail
    const thumbBuffer = await this.storage.createThumbnail(
      webpBuffer,
      this.thumbnailSize,
      this.webpQuality,
    );
    const thumbnailPath = path.join(avatarPath, 'thumb.webp');
    await this.storage.saveFile(thumbnailPath, thumbBuffer);

    // Save/Update in database
    const avatar = await this.prisma.avatar.upsert({
      where: {
        clientId_userId: {
          clientId,
          userId,
        },
      },
      update: {
        storagePath,
        thumbnailPath,
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
        storagePath,
        thumbnailPath,
        format: 'webp',
        width: metadata.width,
        height: metadata.height,
        size: webpBuffer.length,
        mimeType: 'image/webp',
        isOptimized: false,
      },
    });

    return this.formatAvatarResponse(avatar, externalUserId);
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

    const filePath = thumbnail && avatar.thumbnailPath
      ? avatar.thumbnailPath
      : avatar.storagePath;

    const buffer = await this.storage.readFile(filePath);
    return { buffer, mimeType: avatar.mimeType };
  }

  /**
   * Delete user avatar by external user ID
   */
  async deleteAvatar(clientId: string, externalUserId: string): Promise<DeleteAvatarResponseDto> {
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
      throw new NotFoundException('Avatar not found');
    }

    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    const domain = client?.domain || clientId;

    // Delete files
    const avatarPath = this.storage.getAvatarPath(domain, user.id);
    await this.storage.deleteDirectory(avatarPath);

    // Delete from database
    await this.prisma.avatar.delete({
      where: {
        clientId_userId: {
          clientId,
          userId: user.id,
        },
      },
    });

    return this.formatDeleteResponse('Avatar deleted successfully');
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

    return plainToInstance(
      AvatarResponseDto,
      {
        ...avatar,
        url: `/${apiPrefix}/avatars/${externalUserId}`,
        thumbnailUrl: avatar.thumbnailPath ? `/${apiPrefix}/avatars/${externalUserId}?thumb=true` : undefined,
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
