import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { BastionUserJwtGuard } from './guards/bastion-user-jwt.guard';
import { BastionTokenVerifier } from './bastion-token-verifier.service';
import { PrismaModule } from '@/modules/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.register({}),
    HttpModule,
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, BastionTokenVerifier, AdminJwtGuard, BastionUserJwtGuard],
  exports: [AdminAuthService, BastionTokenVerifier, AdminJwtGuard, BastionUserJwtGuard, JwtModule],
})
export class AdminAuthModule {}
