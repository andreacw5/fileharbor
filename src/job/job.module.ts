import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { ImageModule } from '@/image/image.module';
import { AvatarModule } from '@/avatar/avatar.module';
import { AlbumModule } from '@/album/album.module';

@Module({
  imports: [ImageModule, AvatarModule, AlbumModule],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}

