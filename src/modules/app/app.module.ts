import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
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
import { configValidationSchema } from '@/configs/config.validation';
import { MetricsModule } from '@/modules/metrics/metrics.module';
import { MetricsMiddleware } from '@/modules/metrics/metrics.middleware';
import { RouteHelperModule } from '@/utils/route.utils';

// Share tokens grant read access to a private image or album: keep them out of
// the log sink. They travel as `?token=` on GET /images/:id and as the last
// path segment of GET /albums/shared/:token.
function sanitizeLoggedUrl(url: string): string {
  const [path, query] = url.split('?');
  const safePath = path.replace(/\/shared\/[^/]+/, '/shared/[REDACTED]');
  if (!query) return safePath;

  const params = new URLSearchParams(query);
  if (params.has('token')) params.set('token', '[REDACTED]');
  return `${safePath}?${params.toString()}`;
}

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
      cache: true,
      validationSchema: configValidationSchema,
    }),

    // Same pino setup as Bastion: one JSON line per request in production,
    // pino-pretty single-line in development.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const production = config.get('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level:
              config.get<string>('LOG_LEVEL') ??
              (production ? 'info' : 'debug'),
            transport: production
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'req.body.apiKey',
                'req.body.tinifyApiKey',
                'req.body.webhookUrl',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
            genReqId: () => randomUUID(),
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: sanitizeLoggedUrl(req.url),
              }),
              res: (res: { statusCode: number }) => ({
                statusCode: res.statusCode,
              }),
            },
            customProps: () => ({ service: 'fileharbor' }),
            autoLogging: {
              ignore: (req) => (req.url ?? '').startsWith('/health'),
            },
          },
        };
      },
    }),

    // Prometheus metrics, served on METRICS_PORT — not on the API port
    MetricsModule,

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
    // Writes the Bastion audit event declared by `@Audit()` on an admin handler.
    // Registered globally rather than per controller so a new admin route cannot
    // silently skip auditing: a handler with no `@Audit()` is a no-op here.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // MetricsMiddleware is a middleware and not an APP_INTERCEPTOR on purpose:
    // interceptors run after the guards, so 401s and 429s would never be counted.
    consumer
      .apply(MetricsMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
