import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageCleanupJob } from './storage.cleanup.job';

@Global()
@Module({
  providers: [StorageService, StorageCleanupJob],
  exports: [StorageService],
})
export class StorageModule {}

