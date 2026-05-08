import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';
import { StorageModule } from '../storage/storage.module';
import { ImageCleanupJob } from '@/modules/image/image.cleanup.job';

@Module({
  imports: [ClientModule, WebhookModule, StorageModule, HttpModule],
  controllers: [ImageController],
  providers: [ImageService, ImageCleanupJob],
  exports: [ImageService],
})
export class ImageModule {}

