import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { ClientModule } from '@/modules/client/client.module';
import { AdminJwtGuard } from '@/modules/admin/guards/admin-jwt.guard';
import { UserService } from './user.service';
import { UserController, UserClientController } from './user.controller';

@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({}), ClientModule],
  controllers: [UserController, UserClientController],
  providers: [UserService, AdminJwtGuard],
})
export class UserModule {}

