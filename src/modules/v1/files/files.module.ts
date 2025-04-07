import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { PrismaService } from '../../../prisma.service';
import { FilesController } from './files.controller';
import { AssetsModule } from '../assets/assets.module';
import { OwnersModule } from '../owners/owners.module';

@Module({
  imports: [AssetsModule, OwnersModule],
  controllers: [FilesController],
  providers: [FilesService, PrismaService],
  exports: [FilesService],
})
export class FilesModule {}
