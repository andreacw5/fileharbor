import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';
import { StorageModule } from '../storage/storage.module';
import { UserModule } from '../user/user.module';
import { ImageCleanupJob } from '@/modules/image/jobs/image.cleanup.job';
import { TinifyResetJob } from '@/modules/image/jobs/tinify-reset.job';

@Module({
  imports: [ClientModule, WebhookModule, StorageModule, HttpModule, UserModule],
  controllers: [ImageController],
  providers: [ImageService, ImageCleanupJob, TinifyResetJob],
  exports: [ImageService],
})
export class ImageModule {}

