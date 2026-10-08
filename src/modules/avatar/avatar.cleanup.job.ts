import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AvatarService } from '@/modules/avatar/avatar.service';
import {
  MAX_OPTIMIZE_ATTEMPTS,
  StorageService,
} from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class AvatarCleanupJob {
  private readonly logger = new Logger(AvatarCleanupJob.name);
  private readonly originalQuality: number;
  private readonly thumbnailSize: number;
  private readonly thumbnailQuality: number;

  constructor(
    private avatarService: AvatarService,
    private storage: StorageService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    // Re-encode quality for the optimize job; uploads keep ORIGINAL_QUALITY
    this.originalQuality = parseInt(
      this.config.get('OPTIMIZE_QUALITY') || '85',
    );
    // Thumbnail can use lower quality to reduce file size
    this.thumbnailQuality = parseInt(
      this.config.get('THUMBNAIL_QUALITY') || '70',
    );
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Optimize avatars every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async optimizeAvatars() {
    await this.prisma.runExclusive('avatar.optimize', async () => {
      this.logger.debug('Starting avatar optimization job...');

      try {
        // Get unoptimized avatars
        const avatars = await this.avatarService.getUnoptimizedAvatars();
        this.logger.log(`Found ${avatars.length} avatars to optimize`);

        for (const avatar of avatars) {
          try {
            await this.optimizeAvatar(avatar);
            await this.avatarService.markAsOptimized(avatar.id);
            this.logger.log(`Optimized avatar: ${avatar.id}`);
          } catch (error) {
            this.logger.error(
              `Failed to optimize avatar ${avatar.id}:`,
              error.message,
            );
            const gaveUp = await this.avatarService.recordOptimizeFailure(
              avatar.id,
            );
            if (gaveUp) {
              this.logger.warn(
                `Giving up on avatar ${avatar.id} after ${MAX_OPTIMIZE_ATTEMPTS} failed optimization attempts`,
              );
            }
          }
        }

        this.logger.log('Avatar optimization job completed');
      } catch (error) {
        this.logger.error('Avatar optimization job failed:', error.message);
      }
    });
  }

  /**
   * Optimize single avatar
   */
  private async optimizeAvatar(avatar: any) {
    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: avatar.clientId },
      select: { domain: true },
    });
    const domain = client?.domain || avatar.clientId;

    // Read original file
    const originalPath = this.storage.getAvatarFilePath(
      domain,
      avatar.creatorId,
      'original',
    );
    const buffer = await this.storage.readFile(originalPath);

    // Optimize (remove EXIF, compress)
    const optimizedBuffer = await this.storage.optimizeImage(
      buffer,
      this.originalQuality,
    );

    // Save back
    await this.storage.saveFile(originalPath, optimizedBuffer);

    // Re-create thumbnail with optimization
    const thumbPath = this.storage.getAvatarFilePath(
      domain,
      avatar.creatorId,
      'thumb',
    );
    const thumbBuffer = await this.storage.createThumbnail(
      optimizedBuffer,
      this.thumbnailSize,
      this.thumbnailQuality,
    );
    await this.storage.saveFile(thumbPath, thumbBuffer);
  }
}
