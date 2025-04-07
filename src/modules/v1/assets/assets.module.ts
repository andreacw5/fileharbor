import { forwardRef, Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AvatarsModule } from '../avatars/avatars.module';
import { FilesModule } from '../files/files.module';
import { AssetsJob } from './assets.job';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  providers: [AssetsService, AssetsJob],
  exports: [AssetsService],
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => AvatarsModule),
    forwardRef(() => FilesModule)
  ],
})
export class AssetsModule {}
