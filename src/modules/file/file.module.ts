import { Module } from '@nestjs/common';
import { StorageModule } from '@/modules/storage/storage.module';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { CreatorModule } from '@/modules/creator/creator.module';
import { ClientModule } from '@/modules/client/client.module';
import { FileService } from './file.service';
import { FileController } from './file.controller';

@Module({
  imports: [StorageModule, PrismaModule, CreatorModule, ClientModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
