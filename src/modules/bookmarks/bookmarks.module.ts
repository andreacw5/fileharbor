import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { BookmarksService } from './bookmarks.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [BookmarksService],
  exports: [BookmarksService],
})
export class BookmarksModule {}

