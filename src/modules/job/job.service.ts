import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Reset Tinify usage counter for all clients on the 1st of every month at midnight
   * This ensures clients with Tinify enabled get their monthly compression quota refreshed
   */
  @Cron('0 0 1 * *') // Run at midnight on the 1st of every month
  async resetTinifyUsageCounters() {
    this.logger.log('Starting monthly Tinify usage counter reset job...');

    try {
      const result = await this.prisma.client.updateMany({
        where: {
          tinifyActive: true,
        },
        data: {
          currentTinifyUsage: 0,
        },
      });

      this.logger.log(
        `Tinify usage counter reset completed - ${result.count} clients updated`
      );
    } catch (error) {
      this.logger.error('Tinify usage counter reset job failed:', error.message);
    }
  }

}

