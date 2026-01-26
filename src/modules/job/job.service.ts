import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private storage: StorageService,
    private prisma: PrismaService,
  ) {}

  /**
   * Clean up orphaned files from disk every night at 2 AM
   * Removes image and avatar files that don't have a corresponding database record
   */
  @Cron('0 2 * * *')
  async cleanOrphanedFiles() {
    this.logger.log('Starting orphaned files cleanup job...');

    try {
      let orphanedImagesCount = 0;
      let orphanedAvatarsCount = 0;

      // Get all client domains from storage
      const domains = await this.storage.getAllClientDomains();
      this.logger.log(`Found ${domains.length} client domains in storage`);

      for (const domain of domains) {
        try {
          // Get client from database to get clientId
          const client = await this.prisma.client.findFirst({
            where: { domain },
          });

          if (!client) {
            this.logger.warn(`Client not found for domain: ${domain}`);
            continue;
          }

          // Clean orphaned images
          const imageIds = await this.storage.getClientImageIds(domain);
          this.logger.log(`Checking ${imageIds.length} images for client ${domain}`);

          for (const imageId of imageIds) {
            const image = await this.prisma.image.findFirst({
              where: {
                clientId: client.id,
                storagePath: { endsWith: imageId },
              },
            });

            if (!image) {
              // Image not in database, delete from disk
              const imagePath = this.storage.getImagePath(domain, imageId);
              await this.storage.deleteDirectory(imagePath);
              orphanedImagesCount++;
              this.logger.log(`Deleted orphaned image: ${domain}/images/${imageId}`);
            }
          }

          // Clean orphaned avatars
          const avatarUserIds = await this.storage.getClientAvatarUserIds(domain);
          this.logger.log(`Checking ${avatarUserIds.length} avatars for client ${domain}`);

          for (const userId of avatarUserIds) {
            const avatar = await this.prisma.avatar.findFirst({
              where: {
                clientId: client.id,
                userId,
              },
            });

            if (!avatar) {
              // Avatar not in database, delete from disk
              const avatarPath = this.storage.getAvatarPath(domain, userId);
              await this.storage.deleteDirectory(avatarPath);
              orphanedAvatarsCount++;
              this.logger.log(`Deleted orphaned avatar: ${domain}/avatars/${userId}`);
            }
          }
        } catch (error) {
          this.logger.error(`Failed to clean orphaned files for domain ${domain}:`, error.message);
        }
      }

      this.logger.log(
        `Orphaned files cleanup completed - Images: ${orphanedImagesCount}, Avatars: ${orphanedAvatarsCount}`
      );
    } catch (error) {
      this.logger.error('Orphaned files cleanup job failed:', error.message);
    }
  }
}

