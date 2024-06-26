import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import OwnersService from './owners.service';
import { PrismaService } from '../../../prisma.service';
import { HttpModule } from '@nestjs/axios';
import OwnersController from './owners.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, HttpModule, AuthModule],
  providers: [OwnersService, PrismaService],
  exports: [OwnersService],
  controllers: [OwnersController],
})
export class OwnersModule {}
