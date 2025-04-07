import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsJob } from './assets.job';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma.service';

@Module({
  providers: [AssetsService, AssetsJob, PrismaService],
  exports: [AssetsService],
  imports: [
    ScheduleModule.forRoot()
  ],
})
export class AssetsModule {}
