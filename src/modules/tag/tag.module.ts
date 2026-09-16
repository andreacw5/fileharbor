import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { TagService } from './tag.service';
import { TagController } from './tag.controller';

@Module({
  imports: [PrismaModule, ConfigModule, BastionModule],
  controllers: [TagController],
  providers: [TagService],
})
export class TagModule {}
