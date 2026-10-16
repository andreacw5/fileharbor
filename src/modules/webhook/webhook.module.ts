import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '@/modules/prisma/prisma.module';

@Module({
  providers: [WebhookService],
  exports: [WebhookService],
  imports: [
    // No redirects: an allowed Discord URL must not bounce the request elsewhere.
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 0,
      maxContentLength: 1e6,
    }),
    PrismaModule,
  ],
})
export class WebhookModule {}
