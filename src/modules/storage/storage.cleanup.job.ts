import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { stat } from 'fs/promises';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';

// An upload writes its files before its DB row commits (and a failed upload rolls
// the row back): leave anything this young alone so the job can't race an upload.
const MIN_ORPHAN_AGE_MS = 60 * 60 * 1000;

const isRecent = async (dir: string) =>
  (await stat(dir)).mtimeMs > Date.now() - MIN_ORPHAN_AGE_MS;

@Injectable()
export class StorageCleanupJob {
  private readonly logger = new Logger(StorageCleanupJob.name);

  constructor(
    private storage: StorageService,
    private prisma: PrismaService,
  ) {}

  /**
   * Clean up orphaned files from disk every night at 2 AM.
   * Removes image and avatar files that do not have a corresponding database record.
   */
  @Cron('0 2 * * *')
  async cleanOrphanedFiles() {
    await this.prisma.runExclusive('storage.orphan_cleanup', async () => {
      this.logger.log('Starting orphaned files cleanup job...');

      try {
        let orphanedImagesCount = 0;
        let orphanedAvatarsCount = 0;

        // Get all client domains from storage
        const domains = await this.storage.getAllClientDomains();
        this.logger.log(`Found ${domains.length} client domains in storage`);

        for (const domain of domains) {
          try {
            // A client's storage dir is `client.domain || client.id`
            const client = await this.prisma.client.findFirst({
              where: { OR: [{ domain }, { id: domain }] },
              select: { id: true },
            });

            if (!client) {
              this.logger.warn(`Client not found for domain: ${domain}`);
              continue;
            }

            // Clean orphaned images
            const imageIds = await this.storage.getClientImageIds(domain);
            this.logger.log(
              `Checking ${imageIds.length} images for client ${domain}`,
            );

            // One query per client instead of an unindexable `endsWith` per dir.
            // ponytail: holds every storagePath of the client in memory; page it if
            // a single client reaches millions of images.
            const images = await this.prisma.image.findMany({
              where: { clientId: client.id },
              select: { storagePath: true },
            });
            const knownImageIds = new Set(
              images.map((image) => path.basename(image.storagePath)),
            );

            for (const imageId of imageIds) {
              if (!knownImageIds.has(imageId)) {
                // Image not in database, delete from disk
                const imagePath = this.storage.getImagePath(domain, imageId);
                if (await isRecent(imagePath)) continue;
                await this.storage.deleteDirectory(imagePath);
                orphanedImagesCount++;
                this.logger.log(
                  `Deleted orphaned image: ${domain}/images/${imageId}`,
                );
              }
            }

            // Clean orphaned avatars
            const avatarCreatorExternalIds =
              await this.storage.getClientAvatarCreatorExternalIds(domain);
            this.logger.log(
              `Checking ${avatarCreatorExternalIds.length} avatars for client ${domain}`,
            );

            const avatars = await this.prisma.avatar.findMany({
              where: { clientId: client.id },
              select: { creatorId: true },
            });
            const knownAvatarCreators = new Set(
              avatars.map((a) => a.creatorId),
            );

            for (const creatorId of avatarCreatorExternalIds) {
              if (!knownAvatarCreators.has(creatorId)) {
                // Avatar not in database, delete from disk
                const avatarPath = this.storage.getAvatarPath(
                  domain,
                  creatorId,
                );
                if (await isRecent(avatarPath)) continue;
                await this.storage.deleteDirectory(avatarPath);
                orphanedAvatarsCount++;
                this.logger.log(
                  `Deleted orphaned avatar: ${domain}/avatars/${creatorId}`,
                );
              }
            }
          } catch (error) {
            this.logger.error(
              `Failed to clean orphaned files for domain ${domain}:`,
              error.message,
            );
          }
        }

        this.logger.log(
          `Orphaned files cleanup completed - Images: ${orphanedImagesCount}, Avatars: ${orphanedAvatarsCount}`,
        );
      } catch (error) {
        this.logger.error('Orphaned files cleanup job failed:', error.message);
      }
    });
  }
}
