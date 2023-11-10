import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import LocalFilesService from './localFiles.service';
import LocalFilesController from './localFiles.controller';
import {PrismaService} from "../../../prisma.service";

@Module({
    imports: [ConfigModule],
    providers: [LocalFilesService, PrismaService],
    exports: [LocalFilesService],
    controllers: [LocalFilesController],
})
export class LocalFilesModule {}
