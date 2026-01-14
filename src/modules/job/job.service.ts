import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ImageService } from '@/modules/image/image.service';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { AlbumService } from '@/modules/album/album.service';
import { StorageService } from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private readonly originalQuality: number;
  private readonly thumbnailSize: number;
  private readonly thumbnailQuality: number;

  constructor(
    private imageService: ImageService,
    private avatarService: AvatarService,
    private albumService: AlbumService,
    private storage: StorageService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    // Original should be high quality to preserve image fidelity
    this.originalQuality = parseInt(this.config.get('ORIGINAL_QUALITY') || '100');
    // Thumbnail can use lower quality to reduce file size
    this.thumbnailQuality = parseInt(this.config.get('THUMBNAIL_QUALITY') || '70');
    this.thumbnailSize = parseInt(this.config.get('THUMBNAIL_SIZE') || '800');
  }

  /**
   * Optimize images every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async optimizeImages() {
    this.logger.log('Starting image optimization job...');

    try {
      // Get unoptimized images
      const images = await this.imageService.getUnoptimizedImages();
      this.logger.log(`Found ${images.length} images to optimize`);

      for (const image of images) {
        try {
          await this.optimizeImage(image);
          await this.imageService.markAsOptimized(image.id);
          this.logger.log(`Optimized image: ${image.id}`);
        } catch (error) {
          this.logger.error(`Failed to optimize image ${image.id}:`, error.message);
        }
      }

      this.logger.log('Image optimization job completed');
    } catch (error) {
      this.logger.error('Image optimization job failed:', error.message);
    }
  }

  /**
   * Optimize avatars every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async optimizeAvatars() {
    this.logger.log('Starting avatar optimization job...');

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
          this.logger.error(`Failed to optimize avatar ${avatar.id}:`, error.message);
        }
      }

      this.logger.log('Avatar optimization job completed');
    } catch (error) {
      this.logger.error('Avatar optimization job failed:', error.message);
    }
  }

  /**
   * Optimize single image
   */
  private async optimizeImage(image: any) {
    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: image.clientId },
    });
    const domain = client?.domain || image.clientId;

    // Get the image ID from storagePath: storage/domain/images/{imageId}
    const imageId = image.storagePath.split('/').pop();

    // Read original file
    const originalPath = this.storage.getImageFilePath(domain, imageId, 'original');
    const buffer = await this.storage.readFile(originalPath);

    // Optimize (remove EXIF, compress)
    const optimizedBuffer = await this.storage.optimizeImage(
      buffer,
      this.originalQuality,
    );

    // Save back
    await this.storage.saveFile(originalPath, optimizedBuffer);

    // Re-create thumbnail with optimization
    const thumbPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
    const thumbBuffer = await this.storage.createThumbnail(
      optimizedBuffer,
      this.thumbnailSize,
      this.thumbnailQuality
    );
    await this.storage.saveFile(thumbPath, thumbBuffer);
  }

  /**
   * Optimize single avatar
   */
  private async optimizeAvatar(avatar: any) {
    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: avatar.clientId },
    });
    const domain = client?.domain || avatar.clientId;

    // Read original file
    const originalPath = this.storage.getAvatarFilePath(domain, avatar.userId, 'original');
    const buffer = await this.storage.readFile(originalPath);

    // Optimize (remove EXIF, compress)
    const optimizedBuffer = await this.storage.optimizeImage(
      buffer,
      this.originalQuality,
    );

    // Save back
    await this.storage.saveFile(originalPath, optimizedBuffer);

    // Re-create thumbnail with optimization
    const thumbPath = this.storage.getAvatarFilePath(domain, avatar.userId, 'thumb');
    const thumbBuffer = await this.storage.createThumbnail(
      optimizedBuffer,
      this.thumbnailSize,
      this.thumbnailQuality
    );
    await this.storage.saveFile(thumbPath, thumbBuffer);
  }

  /**
   * Clean up expired share links every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpiredShareLinks() {
    this.logger.log('Starting expired share links cleanup job...');

    try {
      const deletedCount = await this.imageService.deleteExpiredShareLinks();
      this.logger.log(`Deleted ${deletedCount} expired share links`);
      this.logger.log('Expired share links cleanup job completed');
    } catch (error) {
      this.logger.error('Expired share links cleanup job failed:', error.message);
    }
  }

  /**
   * Clean up expired album tokens every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpiredAlbumTokens() {
    this.logger.log('Starting expired album tokens cleanup job...');

    try {
      const deletedCount = await this.albumService.deleteExpiredAlbumTokens();
      this.logger.log(`Deleted ${deletedCount} expired album tokens`);
      this.logger.log('Expired album tokens cleanup job completed');
    } catch (error) {
      this.logger.error('Expired album tokens cleanup job failed:', error.message);
    }
  }

  /**
   * Manual trigger for testing
   */
  async triggerOptimization() {
    this.logger.log('Manual optimization triggered');
    await this.optimizeImages();
    await this.optimizeAvatars();
    return { success: true, message: 'Optimization completed' };
  }
}

