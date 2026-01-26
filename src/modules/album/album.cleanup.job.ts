import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlbumService } from './album.service';

@Injectable()
export class AlbumCleanupJob {
  private readonly logger = new Logger(AlbumCleanupJob.name);

  constructor(private albumService: AlbumService) {}

  /**
   * Clean up expired album tokens every 30 minutes
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanExpiredAlbumTokens() {
    this.logger.debug('Starting expired album tokens cleanup job...');

    try {
      const deletedCount = await this.albumService.deleteExpiredAlbumTokens();
      this.logger.log(`Deleted ${deletedCount} expired album tokens`);
      this.logger.log('Expired album tokens cleanup job completed');
    } catch (error) {
      this.logger.error('Expired album tokens cleanup job failed:', error.message);
    }
  }
}
