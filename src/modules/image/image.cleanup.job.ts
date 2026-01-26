import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ImageService } from '@/modules/image/image.service';
import { StorageService } from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class ImageCleanupJob {
  private readonly logger = new Logger(ImageCleanupJob.name);
  private readonly originalQuality: number;
  private readonly thumbnailSize: number;
  private readonly thumbnailQuality: number;

  constructor(
    private imageService: ImageService,
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
    this.logger.debug('Starting image optimization job...');

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
   * Clean up expired share links every hour
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanExpiredShareLinks() {
    this.logger.debug('Starting expired share links cleanup job...');

    try {
      const deletedCount = await this.imageService.deleteExpiredShareLinks();
      this.logger.log(`Deleted ${deletedCount} expired share links`);
      this.logger.log('Expired share links cleanup job completed');
    } catch (error) {
      this.logger.error('Expired share links cleanup job failed:', error.message);
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
}
