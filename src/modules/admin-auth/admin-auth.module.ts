import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { BastionUserJwtGuard } from './guards/bastion-user-jwt.guard';
import { BastionTokenVerifier } from './bastion-token-verifier.service';
import { PrismaModule } from '@/modules/prisma/prisma.module';

/**
 * Token verification only — no controllers.
 *
 * FileHarbor issues no tokens and stores no admin accounts: sign-in, refresh,
 * password and profile all belong to Bastion, and the console (Meridian) talks
 * to Bastion directly. What is left here is the verification of the user JWT
 * that arrives with each request.
 */
@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({})],
  providers: [BastionTokenVerifier, AdminJwtGuard, BastionUserJwtGuard],
  exports: [
    BastionTokenVerifier,
    AdminJwtGuard,
    BastionUserJwtGuard,
    JwtModule,
  ],
})
export class AdminAuthModule {}
