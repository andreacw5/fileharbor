import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AdminAuthModule } from '@/modules/admin-auth/admin-auth.module';
import { TagService } from './tag.service';
import { TagController } from './tag.controller';

@Module({
  imports: [PrismaModule, ConfigModule, AdminAuthModule],
  controllers: [TagController],
  providers: [TagService],
})
export class TagModule {}

