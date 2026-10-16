import { Module } from '@nestjs/common';
import { FileharborMetrics } from './fileharbor-metrics.service';

/** Domain metrics; `MetricsModule` (nest-common, global) is imported once in AppModule. */
@Module({
  providers: [FileharborMetrics],
  exports: [FileharborMetrics],
})
export class FileharborMetricsModule {}
