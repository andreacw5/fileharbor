import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { BastionAuditService } from './bastion-audit.service';
import { BastionJwksService } from './bastion-jwks.service';
import { BastionTokenVerifier } from './bastion-token-verifier.service';
import { BastionService } from './bastion.service';
import { BastionSelfServiceGuard } from './guards/bastion-self-service.guard';
import { BastionUserGuard } from './guards/bastion-user.guard';
import { AuditInterceptor } from './interceptors/audit.interceptor';

/**
 * Everything FileHarbor does with Bastion, in one place: verifying the user
 * tokens that arrive (`BastionJwksService` → `BastionTokenVerifier` → guards)
 * and the calls that go out (`BastionService` → `BastionAuditService`).
 *
 * No controllers. FileHarbor issues no tokens and stores no admin accounts:
 * sign-in, refresh, password and profile all belong to Bastion, and the console
 * (Meridian) talks to Bastion directly.
 *
 * Same layout as the `bastion/` module in Herald, Beacon and Gatherly.
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    BastionService,
    BastionJwksService,
    BastionTokenVerifier,
    BastionAuditService,
    BastionUserGuard,
    BastionSelfServiceGuard,
    AuditInterceptor,
  ],
  exports: [
    BastionService,
    BastionJwksService,
    BastionTokenVerifier,
    BastionAuditService,
    BastionUserGuard,
    BastionSelfServiceGuard,
    AuditInterceptor,
  ],
})
export class BastionModule {}
