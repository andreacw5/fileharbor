import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { ImageModule } from '@/modules/image/image.module';
import { AvatarModule } from '@/modules/avatar/avatar.module';
import { AlbumModule } from '@/modules/album/album.module';

@Module({
  imports: [ImageModule, AvatarModule, AlbumModule],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}

