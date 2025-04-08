import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import { basename, join, resolve, sep } from 'path';
import { promises as fs, statSync } from 'fs';

@Injectable()
export class AssetsService {
  private readonly uploadBase = join(process.cwd(), 'uploads');
  private readonly filesBase = join(this.uploadBase, 'files');
  private readonly avatarsBase = join(this.uploadBase, 'avatars');

  private readonly logger = new Logger(AssetsService.name);

  /**
   * Resolves the absolute path of a file
   * @param filePath
   * @private
   */
  private resolveAbsolutePath(filePath: string): string {
    const absolutePath = filePath.startsWith(this.uploadBase)
      ? filePath
      : resolve(this.uploadBase, filePath.replace(/^uploads[\\/]/, ''));

    if (!absolutePath.startsWith(this.uploadBase + sep)) {
      this.logger.error('Invalid file path: outside uploads directory');
      throw new Error('Invalid file path: outside uploads directory');
    }

    return absolutePath;
  }

  /**
   * Gets the target paths for a file
   * @param filePath
   * @param domain
   * @param isAvatar
   * @private
   */
  private getTargetPaths(filePath: string, domain: string, isAvatar: boolean) {
    const baseTarget = isAvatar ? this.avatarsBase : this.filesBase;
    const targetDir = join(baseTarget, domain);
    const targetPath = join(targetDir, basename(filePath));

    if (!targetPath.startsWith(targetDir + sep)) {
      this.logger.log('Target path does not exist');
      throw new Error('Invalid target path: possible path traversal');
    }

    return { targetDir, targetPath };
  }

  /**
   * Moves a file into the correct domain folder (works for both files and avatars)
   * @param filePath Full path or relative (starting with uploads/)
   * @param domain Target domain
   * @param isAvatar Whether it's an avatar or not
   */
  async moveFileToDomainFolder(
    filePath: string,
    domain: string,
    isAvatar = false,
  ): Promise<void> {
    const absoluteFilePath = this.resolveAbsolutePath(filePath);
    const { targetDir, targetPath } = this.getTargetPaths(
      absoluteFilePath,
      domain,
      isAvatar,
    );

    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.rename(absoluteFilePath, targetPath);
      this.logger.log(
        `Moved file to ${isAvatar ? 'avatar' : 'file'} domain folder: ${targetPath}`,
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.error(`Source file does not exist: ${absoluteFilePath}`);
      } else {
        this.logger.error(
          `Failed to move file from ${absoluteFilePath} to ${targetPath}`,
          error,
        );
      }
      throw error;
    }
  }

  /**
   * Optimizes an image file using WebP
   * @param filePath Path to the input file (will be overwritten if overwrite = true)
   * @param outputFilePath Path where optimized file will be saved
   * @param overwrite If true, replaces original file
   */
  async optimizeFile(
    filePath: string,
    outputFilePath: string,
    overwrite = true,
  ): Promise<{
    originalSize: number;
    optimizedSize: number;
    reduction: number;
    optimizedPath: string;
  } | null> {
    try {
      // Check if file exists
      await fs.access(filePath);

      const originalSize = statSync(filePath).size;

      // Optimize the file
      await sharp(filePath)
        .webp({ effort: 4, quality: 80 })
        .toFile(outputFilePath);

      const optimizedSize = statSync(outputFilePath).size;

      if (overwrite) {
        await fs.rename(outputFilePath, filePath);
      }

      this.logger.log(
        `Optimized file: ${filePath} (${originalSize} → ${optimizedSize} bytes, saved ${originalSize - optimizedSize} bytes)`,
      );

      return {
        originalSize,
        optimizedSize,
        reduction: originalSize - optimizedSize,
        optimizedPath: overwrite ? filePath : outputFilePath,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to optimize file: ${filePath}`,
        error?.message || error,
      );
      return null;
    }
  }

  /**
   * Deletes a file by its path
   * @param {string} filePath
   * @param isAvatar
   * @param domain
   */
  async deleteFileByPath(
    filePath: string,
    isAvatar: boolean,
    domain: string,
  ): Promise<void> {
    const absoluteFilePath = this.resolveAbsolutePath(filePath);
    const { targetPath } = this.getTargetPaths(
      absoluteFilePath,
      domain,
      isAvatar,
    );

    try {
      await fs.unlink(targetPath);
      this.logger.log(`File deleted: ${targetPath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`File not found, nothing to delete: ${targetPath}`);
      } else {
        this.logger.error(`Failed to delete file: ${targetPath}`, error);
      }
    }
  }
}
