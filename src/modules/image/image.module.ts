import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageController } from './image.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [ClientModule, WebhookModule],
  controllers: [ImageController],
  providers: [ImageService],
  exports: [ImageService],
})
export class ImageModule {}

