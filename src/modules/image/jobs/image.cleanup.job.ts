import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ImageService } from '@/modules/image/image.service';
import {
  MAX_OPTIMIZE_ATTEMPTS,
  StorageService,
} from '@/modules/storage/storage.service';
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
   * Optimize images every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async optimizeImages() {
    await this.prisma.runExclusive('image.optimize', async () => {
      this.logger.debug('Starting image optimization job...');

      try {
        // Get unoptimized images
        const images = await this.imageService.getUnoptimizedImages();
        this.logger.log(`Found ${images.length} images to optimize`);

        for (const image of images) {
          try {
            const size = await this.optimizeImage(image);
            await this.imageService.markAsOptimized(image.id, size);
            this.logger.log(`Optimized image: ${image.id}`);
          } catch (error) {
            this.logger.error(
              `Failed to optimize image ${image.id}:`,
              error.message,
            );
            const gaveUp = await this.imageService.recordOptimizeFailure(
              image.id,
            );
            if (gaveUp) {
              this.logger.warn(
                `Giving up on image ${image.id} after ${MAX_OPTIMIZE_ATTEMPTS} failed optimization attempts`,
              );
            }
          }
        }

        this.logger.log('Image optimization job completed');
      } catch (error) {
        this.logger.error('Image optimization job failed:', error.message);
      }
    });
  }

  /**
   * Clean up expired share links every day at 4am
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanExpiredShareLinks() {
    await this.prisma.runExclusive('image.share_links_cleanup', async () => {
      this.logger.debug('Starting expired share links cleanup job...');

      try {
        const deletedCount = await this.imageService.deleteExpiredShareLinks();
        this.logger.log(`Deleted ${deletedCount} expired share links`);
        this.logger.log('Expired share links cleanup job completed');
      } catch (error) {
        this.logger.error(
          'Expired share links cleanup job failed:',
          error.message,
        );
      }
    });
  }

  /**
   * Optimize single image, returning the new size of the original
   */
  private async optimizeImage(image: any): Promise<number> {
    // Get client to retrieve domain
    const client = await this.prisma.client.findUnique({
      where: { id: image.clientId },
      select: { domain: true },
    });
    const domain = client?.domain || image.clientId;

    // Get the image ID from storagePath: storage/domain/images/{imageId}
    const imageId = image.storagePath.split('/').pop();

    // Read original file
    const originalPath = this.storage.getImageFilePath(
      domain,
      imageId,
      'original',
    );
    const buffer = await this.storage.readFile(originalPath);

    // Optimize (remove EXIF, compress)
    const optimizedBuffer = await this.storage.optimizeImage(
      buffer,
      this.originalQuality,
    );

    // Both encoded before anything is written, the original written last: a
    // failure leaves the original untouched, so the next run doesn't re-encode
    // an already q85 file (generation loss).
    const thumbPath = this.storage.getImageFilePath(domain, imageId, 'thumb');
    const thumbBuffer = await this.storage.createThumbnail(
      optimizedBuffer,
      this.thumbnailSize,
      this.thumbnailQuality,
    );
    await this.storage.saveFile(thumbPath, thumbBuffer);
    await this.storage.saveFile(originalPath, optimizedBuffer);
    // Best-effort: the original is already rewritten, so a failure here must
    // not fail the row (the next run would re-encode the q85 file). A stale
    // variant dir only costs disk until the next miss or regenerate.
    await this.storage
      .clearImageVariants(domain, imageId)
      .catch((e: unknown) =>
        this.logger.warn(
          `[optimizeImage] ${imageId}: variants not cleared: ${e instanceof Error ? e.message : e}`,
        ),
      );

    return optimizedBuffer.length;
  }
}
