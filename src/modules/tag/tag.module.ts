import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AdminJwtGuard } from '@/modules/admin/guards/admin-jwt.guard';
import { TagService } from './tag.service';
import { TagController } from './tag.controller';

@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({})],
  controllers: [TagController],
  providers: [TagService, AdminJwtGuard],
})
export class TagModule {}

