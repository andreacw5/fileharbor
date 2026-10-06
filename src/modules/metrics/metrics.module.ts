import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsServer } from './metrics.server';

@Module({
  providers: [MetricsService, MetricsServer],
  exports: [MetricsService],
})
export class MetricsModule {}
