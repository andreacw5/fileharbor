import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { promises as fs } from 'fs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AvatarsService } from '../avatars/avatars.service';
import { FilesService } from '../files/files.service';
import { AssetsService } from './assets.service';

@Injectable()
export class AssetsJob {
  constructor(
    private avatarService: AvatarsService,
    private filesService: FilesService,
    private assetService: AssetsService,
  ) {}

  private readonly uploadBase = join(process.cwd(), 'uploads');
  private readonly logger = new Logger(AssetsJob.name);

  /**
   * Optimizes all files in the database that are not already optimized
   * This method will run every 4 hours to optimize files
   */
  @Cron(CronExpression.EVERY_4_HOURS)
  async optimizeFilesAndAvatars() {
    this.logger.log('Starting optimization for files and avatars');

    // Get files from the `localFile` table
    const files = await this.filesService.getAllFiles({
      where: { optimized: false },
    });

    // Get avatars from the `avatar` table
    const avatars = await this.avatarService.getAllAvatars({
      where: { optimized: false },
    });

    const allAssets = [...files, ...avatars];

    if (!allAssets.length) {
      this.logger.log('No files or avatars to optimize.');
      return;
    }

    const tmpDir = join(process.cwd(), 'uploads/tmp');
    await fs.mkdir(tmpDir, { recursive: true });

    for (const asset of allAssets) {
      const filePath = join(process.cwd(), asset.path);
      const tmpFilePath = join(tmpDir, `${asset.id}.webp`);
      const isAvatar = 'avatarUrl' in asset; // Check if the asset is an avatar (specific field check)
      const type = isAvatar ? 'avatar' : 'file';

      try {
        // Optimize the file
        const result = await this.assetService.optimizeFile(filePath, tmpFilePath, true); // overwrite the original file

        if (result) {
          if (isAvatar) {
            // Update the Avatar in the DB
            await this.avatarService.updateAvatar(asset.id, {
              size: result.optimizedSize,
              mimetype: 'image/webp',
              optimized: true,
            });
          } else {
            // Update the File in the DB
            await this.filesService.updateFile(asset.id, {
              size: result.optimizedSize,
              mimetype: 'image/webp',
              optimized: true,
            });
          }

          this.logger.log(
            `Optimized ${type} ${asset.id}: ${result.originalSize} → ${result.optimizedSize} bytes`
          );
        } else {
          this.logger.warn(`Skipped optimization for ${asset.id} (unsupported type?)`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to optimize ${asset.id}`, err?.message || err);
      } finally {
        // Cleanup temporary files
        try {
          await fs.unlink(tmpFilePath);
        } catch (_) {
          // silently ignore
        }
      }
    }

    this.logger.log('Optimization completed for files and avatars.');
  }
}
