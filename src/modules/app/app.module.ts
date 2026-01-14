import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { StorageModule } from "@/modules/storage/storage.module";
import { ClientModule } from "@/modules/client/client.module";
import { ImageModule } from "@/modules/image/image.module";
import { AvatarModule } from "@/modules/avatar/avatar.module";
import { AlbumModule } from "@/modules/album/album.module";
import { JobModule } from "@/modules/job/job.module";
import config from '../../configs/config.schema';
import { configValidationSchema } from '@/configs/config.validation';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
    controllers: [StatusController],
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
        ThrottlerModule.forRoot([{
            ttl: parseInt(process.env.THROTTLE_TTL || '60') * 1000,
            limit: parseInt(process.env.THROTTLE_LIMIT || '10'),
        }]),

        // Scheduling for jobs
        ScheduleModule.forRoot(),

        // Core modules
        PrismaModule,
        StorageModule,
        ClientModule,
        ImageModule,
        AvatarModule,
        AlbumModule,
        JobModule,
    ],
})
export class AppModule {}

