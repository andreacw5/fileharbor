import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Readiness of the media volume: STORAGE_PATH must be writable and keep at
 * least HEALTH_DISK_MIN_FREE_MB free. Uploads, variant caching and the optimize
 * jobs all write there, so a full or read-only volume means the instance can't
 * do its job even with the database up.
 */
@Injectable()
export class StorageHealthIndicator {
  private readonly storagePath: string;
  private readonly minFreeBytes: number;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService,
  ) {
    this.storagePath = path.resolve(
      config.get<string>('STORAGE_PATH') || './storage',
    );
    this.minFreeBytes =
      (config.get<number>('HEALTH_DISK_MIN_FREE_MB') ?? 1024) * 1024 * 1024;
  }

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await fs.access(this.storagePath, fsConstants.W_OK);
      const stats = await fs.statfs(this.storagePath);
      // bavail: blocks available to unprivileged users (what the app can use)
      const freeBytes = stats.bavail * stats.bsize;
      const freeMb = Math.floor(freeBytes / 1024 / 1024);
      const minFreeMb = Math.floor(this.minFreeBytes / 1024 / 1024);
      if (freeBytes < this.minFreeBytes) {
        return indicator.down({
          message: 'Free space below threshold',
          freeMb,
          minFreeMb,
        });
      }
      return indicator.up({ freeMb, minFreeMb });
    } catch (error) {
      // No path in the message: the probe is public.
      return indicator.down({
        message: `Storage not writable: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`,
      });
    }
  }
}
