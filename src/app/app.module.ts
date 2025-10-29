import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import {ConfigModule} from "@nestjs/config";
import {ThrottlerModule} from "@nestjs/throttler";
import {ScheduleModule} from "@nestjs/schedule";
import {PrismaModule} from "@/prisma/prisma.module";
import {StorageModule} from "@/storage/storage.module";
import {ClientModule} from "@/client/client.module";
import {ImageModule} from "@/image/image.module";
import {AvatarModule} from "@/avatar/avatar.module";
import {AlbumModule} from "@/album/album.module";
import {JobModule} from "@/job/job.module";

@Module({
    controllers: [StatusController],
    imports: [
        // Configuration
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
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

