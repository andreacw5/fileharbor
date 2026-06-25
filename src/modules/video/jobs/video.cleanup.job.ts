import { Injectable, Logger } from '@nestjs/common';
// import { Cron, CronExpression } from '@nestjs/schedule';
import { StorageService } from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class VideoCleanupJob {
  private readonly logger = new Logger(VideoCleanupJob.name);

  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  // @Cron(CronExpression.EVERY_HOUR)
  async cleanOrphanedVideos() {
    this.logger.debug('Starting orphaned video cleanup...');

    try {
      const domains = await this.storage.getAllClientDomains();

      for (const domain of domains) {
        const diskVideoIds = await this.storage.getClientVideoIds(domain);

        for (const videoId of diskVideoIds) {
          const exists = await this.prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true },
          });

          if (!exists) {
            const videoDir = this.storage.getVideoPath(domain, videoId);
            await this.storage.deleteDirectory(videoDir);
            this.logger.log(`[cleanOrphanedVideos] Deleted orphaned video dir: ${videoDir}`);
          }
        }
      }

      this.logger.log('Orphaned video cleanup completed');
    } catch (error) {
      this.logger.error('Orphaned video cleanup failed:', error instanceof Error ? error.message : error);
    }
  }
}
