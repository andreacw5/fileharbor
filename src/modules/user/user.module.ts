import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AdminJwtGuard } from '@/modules/admin/guards/admin-jwt.guard';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({})],
  controllers: [UserController],
  providers: [UserService, AdminJwtGuard],
})
export class UserModule {}

