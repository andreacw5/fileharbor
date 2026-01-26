import { Module } from '@nestjs/common';
import { JobService } from './job.service';

@Module({
  imports: [],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}

