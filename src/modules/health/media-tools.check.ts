import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';

/**
 * Boot-time presence check for the ffmpeg/ffprobe binaries video uploads rely
 * on. A missing binary doesn't stop the service (images and avatars don't need
 * it) and uploads still return 2xx, so without this the only signal is
 * `fileharbor_video_processing_failures_total`: warn once at boot instead.
 */
@Injectable()
export class MediaToolsCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaToolsCheck.name);

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.checkBinary('ffmpeg', () => require('ffmpeg-static')),
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.checkBinary('ffprobe', () => require('ffprobe-static')?.path),
    ]);
  }

  private async checkBinary(
    name: string,
    resolve: () => string | null | undefined,
  ): Promise<void> {
    let binaryPath: string | null | undefined;
    try {
      binaryPath = resolve();
    } catch {
      binaryPath = undefined;
    }
    if (!binaryPath) {
      this.logger.warn(
        `${name} binary not available for this platform: video thumbnails/metadata will fail`,
      );
      return;
    }
    try {
      await fs.access(binaryPath, fsConstants.X_OK);
    } catch {
      this.logger.warn(
        `${name} binary missing or not executable at ${binaryPath}: video thumbnails/metadata will fail`,
      );
    }
  }
}
