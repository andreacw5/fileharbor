import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import {
  AllExceptionsFilter,
  loggerParams,
  TransformInterceptor,
} from '@heyatom/nest-common';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { StorageModule } from '@/modules/storage/storage.module';
import { ClientModule } from '@/modules/client/client.module';
import { ImageModule } from '@/modules/image/image.module';
import { AvatarModule } from '@/modules/avatar/avatar.module';
import { AlbumModule } from '@/modules/album/album.module';
import { AdminModule } from '@/modules/admin/admin.module';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { AuditInterceptor } from '@heyatom/bastion-client/nest';
import { MeModule } from '@/modules/me/me.module';
import { VideoModule } from '@/modules/video/video.module';
import { StatisticsModule } from '@/modules/statistics/statistics.module';
import { CreatorModule } from '@/modules/creator/creator.module';
import { TagModule } from '@/modules/tag/tag.module';
import { HealthModule } from '@/modules/health/health.module';
import config from '../../configs/config.schema';
import { validateConfig } from '@/configs/config.validation';
import { MetricsModule } from '@heyatom/nest-common/metrics';
import { RouteHelperModule } from '@/utils/route.utils';
import { sanitizeLoggedUrl } from '@/common/share-tokens';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
      cache: true,
      validate: validateConfig,
    }),

    // nest-common pino setup (api.md §7): server-generated request id, also sent
    // back as X-Request-Id; a well-formed inbound X-Request-Id is logged as
    // clientRequestId only. The req serializer strips share tokens from the URL.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const production = config.get('NODE_ENV') === 'production';
        return loggerParams({
          service: 'fileharbor',
          level:
            config.get<string>('LOG_LEVEL') ?? (production ? 'info' : 'debug'),
          pretty: !production,
          serializers: {
            req: (req: {
              id: unknown;
              method: string;
              url: string;
              remoteAddress?: string;
            }) => ({
              id: req.id,
              method: req.method,
              url: sanitizeLoggedUrl(req.url),
              remoteAddress: req.remoteAddress,
            }),
          },
        });
      },
    }),

    // Prometheus metrics on their own server (METRICS_PORT), never on the API port.
    // Applies MetricsMiddleware to every route itself: a middleware, not an
    // interceptor, so guard 401s and throttler 429s are counted.
    MetricsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        app: 'fileharbor',
        port: config.getOrThrow<number>('metricsPort'),
      }),
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get('throttle.ttl') * 1000,
          limit: configService.get('throttle.limit'),
        },
      ],
      inject: [ConfigService],
    }),

    // Scheduling for jobs
    ScheduleModule.forRoot(),

    // Core modules
    PrismaModule,
    BastionModule,
    StorageModule,
    ClientModule,
    ImageModule,
    AvatarModule,
    AlbumModule,
    CreatorModule,
    RouteHelperModule,
    HealthModule,

    // Video module
    VideoModule,

    // Admin module
    AdminModule,
    StatisticsModule,
    TagModule,

    // Self-service (Bastion user JWT) module
    MeModule,
  ],
  providers: [
    // Rate limiting applies to every route; opt out with `@SkipThrottle()`.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // api.md §2: `{ data }` envelope; paginate() results pass through as
    // `{ data, meta }`, @NoTransform() handlers (files, streams, health) untouched.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // After TransformInterceptor, so inner: sees the handler's raw result.
    // Writes the Bastion audit event declared by `@Audit()` on an admin handler.
    // Registered globally rather than per controller so a new admin route cannot
    // silently skip auditing: a handler with no `@Audit()` is a no-op here.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // api.md §3: answers every exception (HTTP, Prisma P2002/P2003/P2025, anything
    // else as 500) with { statusCode, code, message, errors?, requestId }. Logs only
    // 5xx/401/403/429, so scanner 404s stay out of the logs and still get a reply.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
