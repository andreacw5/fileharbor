import { Module } from '@nestjs/common';
import { AlbumService } from './album.service';
import { AlbumController } from './album.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    ClientModule,
    WebhookModule,
  ],
  controllers: [AlbumController],
  providers: [AlbumService],
  exports: [AlbumService],
})
export class AlbumModule {}

