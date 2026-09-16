import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { ClientModule } from '@/modules/client/client.module';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { CreatorService } from './creator.service';
import { CreatorClientController } from './creator.controller';

@Module({
  imports: [PrismaModule, ConfigModule, BastionModule, ClientModule],
  controllers: [CreatorClientController],
  providers: [CreatorService],
  exports: [CreatorService],
})
export class CreatorModule {}
