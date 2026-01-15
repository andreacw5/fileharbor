import { Module } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { AvatarController } from './avatar.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [ClientModule, WebhookModule],
  controllers: [AvatarController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarModule {}

