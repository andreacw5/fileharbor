import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '@/modules/prisma/prisma.module';

@Module({
  providers: [WebhookService],
  exports: [WebhookService],
  imports: [HttpModule, PrismaModule]
})
export class WebhookModule {}
