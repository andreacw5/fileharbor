import { Module } from '@nestjs/common';
import { AlbumService } from './album.service';
import { AlbumController } from './album.controller';
import { AlbumCleanupJob } from './album.cleanup.job';
import { ClientModule } from '../client/client.module';

@Module({
  imports: [ClientModule],
  controllers: [AlbumController],
  providers: [AlbumService, AlbumCleanupJob],
  exports: [AlbumService],
})
export class AlbumModule {}
