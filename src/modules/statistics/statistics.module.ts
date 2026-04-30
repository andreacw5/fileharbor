import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AdminJwtGuard } from '@/modules/admin/guards/admin-jwt.guard';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({})],
  controllers: [StatisticsController],
  providers: [StatisticsService, AdminJwtGuard],
  exports: [StatisticsService],
})
export class StatisticsModule {}

