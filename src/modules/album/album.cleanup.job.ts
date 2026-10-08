import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlbumService } from './album.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class AlbumCleanupJob {
  private readonly logger = new Logger(AlbumCleanupJob.name);

  constructor(
    private albumService: AlbumService,
    private prisma: PrismaService,
  ) {}

  /**
   * Clean up expired album tokens every day at 4 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanExpiredAlbumTokens() {
    await this.prisma.runExclusive('album.tokens_cleanup', async () => {
      this.logger.debug('Starting expired album tokens cleanup job...');

      try {
        const deletedCount = await this.albumService.deleteExpiredAlbumTokens();
        this.logger.log(`Deleted ${deletedCount} expired album tokens`);
        this.logger.log('Expired album tokens cleanup job completed');
      } catch (error) {
        this.logger.error(
          'Expired album tokens cleanup job failed:',
          error.message,
        );
      }
    });
  }
}
