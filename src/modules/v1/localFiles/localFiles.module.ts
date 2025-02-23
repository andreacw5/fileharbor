import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import LocalFilesService from './localFiles.service';
import LocalFilesController from './localFiles.controller';
import { PrismaService } from '../../../prisma.service';
import { HttpModule } from '@nestjs/axios';
import { OwnersModule } from '../owners/owners.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        ttl: configService.get('CACHE_TTL'),
      }),
      inject: [ConfigService],
    }),
    HttpModule,
    OwnersModule,
  ],
  providers: [LocalFilesService, PrismaService],
  exports: [LocalFilesService],
  controllers: [LocalFilesController],
})
export class LocalFilesModule {}
