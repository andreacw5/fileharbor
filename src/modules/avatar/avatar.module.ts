import { Module } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { AvatarController } from './avatar.controller';
import { ClientModule } from '../client/client.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AvatarCleanupJob } from '@/modules/avatar/avatar.cleanup.job';

@Module({
  imports: [ClientModule, WebhookModule],
  controllers: [AvatarController],
  providers: [AvatarService, AvatarCleanupJob],
  exports: [AvatarService],
})
export class AvatarModule {}

