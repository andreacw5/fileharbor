import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { AvatarModule } from '@/modules/avatar/avatar.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';

/**
 * Self-service endpoints for the signed-in Bastion user (e.g. /me/avatar).
 * Guarded by BastionSelfServiceGuard — verifies the Bastion user JWT but requires
 * none of the console permissions the admin/ module enforces.
 */
@Module({
  imports: [BastionModule, AvatarModule, PrismaModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
