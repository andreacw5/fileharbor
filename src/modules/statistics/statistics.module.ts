import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { StorageSnapshotJob } from './storage-snapshot.job';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { BastionModule } from '@/modules/bastion/bastion.module';

@Module({
  imports: [PrismaModule, BastionModule],
  controllers: [StatisticsController],
  providers: [StatisticsService, StorageSnapshotJob],
  exports: [StatisticsService],
})
export class StatisticsModule {}
