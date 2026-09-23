import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
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
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { RouteHelperModule } from '@/utils/route.utils';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
      cache: true,
      validationSchema: configValidationSchema,
    }),

    // Prometheus configuration
    PrometheusModule.register({
      defaultLabels: {
        app: 'fileharbor',
      },
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
    // Writes the Bastion audit event declared by `@Audit()` on an admin handler.
    // Registered globally rather than per controller so a new admin route cannot
    // silently skip auditing: a handler with no `@Audit()` is a no-op here.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
