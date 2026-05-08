import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { ClientModule } from '@/modules/client/client.module';
import { AdminAuthModule } from '@/modules/admin-auth/admin-auth.module';
import { UserService } from './user.service';
import { UserClientController } from './user.controller';

@Module({
  imports: [PrismaModule, ConfigModule, AdminAuthModule, ClientModule],
  controllers: [UserClientController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}

