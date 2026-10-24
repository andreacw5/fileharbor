import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';
import { StorageModule } from '../storage/storage.module';
import { CreatorModule } from '../creator/creator.module';
import { ImageCleanupJob } from '@/modules/image/jobs/image.cleanup.job';
import { TinifyResetJob } from '@/modules/image/jobs/tinify-reset.job';
import { TinifyAutoJob } from '@/modules/image/jobs/tinify-auto.job';
import { FileharborMetricsModule } from '@/modules/metrics/fileharbor-metrics.module';

@Module({
  imports: [
    ClientModule,
    WebhookModule,
    StorageModule,
    // Tinify: a hung call would hold TinifyAutoJob's advisory lock (and the job) forever.
    // A timeout has no response, so its quota slot is refunded.
    HttpModule.register({ timeout: 60_000 }),
    CreatorModule,
    FileharborMetricsModule,
  ],
  controllers: [ImageController],
  providers: [ImageService, ImageCleanupJob, TinifyResetJob, TinifyAutoJob],
  exports: [ImageService],
})
export class ImageModule {}
