import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BastionModule as BastionClientModule } from '@heyatom/bastion-client/nest';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { BastionTokenVerifier } from './bastion-token-verifier.service';
import { BastionSelfServiceGuard } from './guards/bastion-self-service.guard';
import { BastionUserGuard } from './guards/bastion-user.guard';

/**
 * Everything FileHarbor does with Bastion. The shared machinery comes from
 * `@heyatom/bastion-client` (global once imported here): JWKS verification
 * (`BastionJwksService`), the service-client token and audit writes
 * (`BastionAuditService`), and `AuditInterceptor`.
 *
 * What stays local is FileHarbor-specific: `BastionTokenVerifier` (user tokens
 * of several apps), the console guard (permissions, principal lookup, client
 * scope) and the self-service guard.
 *
 * No controllers. FileHarbor issues no tokens and stores no admin accounts:
 * sign-in, refresh, password and profile all belong to Bastion, and the console
 * (Meridian) talks to Bastion directly.
 */
@Module({
  imports: [
    PrismaModule,
    BastionClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const serviceSlug = config.getOrThrow<string>('bastionAppSlug');
        // Empty → BASTION_APP_SLUG alone, so an unset variable keeps the
        // single-slug behaviour rather than silently widening what is accepted.
        const accepted = (config.get<string>('adminAcceptedAppSlugs') ?? '')
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean);
        return {
          baseUrl: config.getOrThrow<string>('bastionUrl'),
          serviceSlug,
          apiKey: config.get<string>('bastionClientApiKey') || undefined,
          tenantSlug: config.get<string>('bastionTenantSlug') || undefined,
          jwksTtlMs: config.get<number>('bastionJwksTtlMs'),
          acceptedAppSlugs: accepted.length ? accepted : [serviceSlug],
        };
      },
    }),
  ],
  providers: [BastionTokenVerifier, BastionUserGuard, BastionSelfServiceGuard],
  exports: [BastionTokenVerifier, BastionUserGuard, BastionSelfServiceGuard],
})
export class BastionModule {}
