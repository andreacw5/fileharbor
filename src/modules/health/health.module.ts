import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { StorageHealthIndicator } from './storage-health.indicator';
import { MediaToolsCheck } from './media-tools.check';

@Module({
  imports: [TerminusModule, PrismaModule],
  controllers: [HealthController],
  providers: [StorageHealthIndicator, MediaToolsCheck],
})
export class HealthModule {}
