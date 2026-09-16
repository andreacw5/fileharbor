import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { StorageModule } from '@/modules/storage/storage.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { WebhookModule } from '@/modules/webhook/webhook.module';
import { CreatorModule } from '@/modules/creator/creator.module';
import { ClientModule } from '@/modules/client/client.module';
import { RouteHelperModule } from '@/utils/route.utils';
import { VideoCleanupJob } from './jobs/video.cleanup.job';

@Module({
  imports: [
    StorageModule,
    PrismaModule,
    WebhookModule,
    HttpModule,
    CreatorModule,
    ClientModule,
    RouteHelperModule,
  ],
  controllers: [VideoController],
  providers: [VideoService, VideoCleanupJob],
  exports: [VideoService],
})
export class VideoModule {}
