import { Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { StorageModule } from '@/modules/storage/storage.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { WebhookModule } from '@/modules/webhook/webhook.module';
import { CreatorModule } from '@/modules/creator/creator.module';
import { ClientModule } from '@/modules/client/client.module';
import { RouteHelperModule } from '@/utils/route.utils';
import { FileharborMetricsModule } from '@/modules/metrics/fileharbor-metrics.module';

@Module({
  imports: [
    StorageModule,
    PrismaModule,
    WebhookModule,
    CreatorModule,
    ClientModule,
    RouteHelperModule,
    FileharborMetricsModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
