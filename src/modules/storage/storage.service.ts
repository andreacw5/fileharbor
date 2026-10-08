import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

// Decoded-pixel cap for every sharp call: a small compressed file can declare
// enormous dimensions (decompression bomb). 100 MP fits a 48 MP phone photo
// with room to spare, at ~400 MB of RGBA per pipeline.
const MAX_INPUT_PIXELS = 100_000_000;

/** Formats accepted on upload, as reported by sharp from the bytes themselves. */
export const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif'];

// Multer limits for image/avatar uploads. Read from process.env at load time,
// like MAX_VIDEO_SIZE: interceptor options are fixed when the decorator runs.
export const IMAGE_UPLOAD_LIMITS = {
  fileSize: parseInt(process.env.MAX_FILE_SIZE ?? '', 10) || 10485760,
  files: 20,
};

function openImage(input: Buffer) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
}
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import fluentFfmpeg from 'fluent-ffmpeg';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffmpegStaticPath: string | null = require('ffmpeg-static');
  if (ffmpegStaticPath) {
    fluentFfmpeg.setFfmpegPath(ffmpegStaticPath);
  }
} catch {
  // ffmpeg-static not available; thumbnail extraction will fail at runtime
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffprobeStatic = require('ffprobe-static');
  if (ffprobeStatic?.path) {
    fluentFfmpeg.setFfprobePath(ffprobeStatic.path);
  }
} catch {
  // ffprobe-static not available; metadata extraction will fail at runtime
}

/**
 * Failed optimization runs after which an image/avatar is left unoptimized and
 * no longer retried by the hourly jobs. Reset `optimizeAttempts` to 0 to retry.
 */
export const MAX_OPTIMIZE_ATTEMPTS = 3;

/**
 * Image/avatar rows the optimize jobs still pick up. Shared with the
 * `fileharbor_unoptimized_*` gauges so the alert and the job never disagree.
 */
export const OPTIMIZE_RETRYABLE_WHERE = {
  isOptimized: false,
  optimizeAttempts: { lt: MAX_OPTIMIZE_ATTEMPTS },
};

/** Rows the optimize jobs gave up on: only a manual reset retries them. */
export const OPTIMIZE_GIVEN_UP_WHERE = {
  isOptimized: false,
  optimizeAttempts: { gte: MAX_OPTIMIZE_ATTEMPTS },
};

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storagePath: string;

  constructor(private configService: ConfigService) {
    this.storagePath =
      this.configService.get<string>('STORAGE_PATH') || './storage';
  }

  /**
   * Validate that a path is within the storage directory
   * Prevents directory traversal attacks
   */
  private validatePath(targetPath: string): void {
    const normalizedTarget = path.resolve(targetPath);
    const normalizedStorage = path.resolve(this.storagePath);

    // A prefix check would let `storage-evil/` pass for `storage/`.
    const relative = path.relative(normalizedStorage, normalizedTarget);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      this.logger.error(
        `[validatePath] Path traversal attempt detected: ${targetPath}`,
      );
      throw new InternalServerErrorException('Invalid path: Access denied');
    }
  }

  /**
   * Sanitize path component to prevent directory traversal
   * Allows dots for domain names (e.g., example.com)
   * Blocks path separators and null bytes
   */
  private sanitizePathComponent(component: string): string {
    // Remove path separators, parent directory references, and null bytes
    // Allow dots for domain names but block ".." sequences
    return component
      .replace(/\.\./g, '_') // Block parent directory traversal
      .replace(/[/\\\0]/g, '_'); // Block path separators and null bytes
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      this.validatePath(dirPath);
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      this.logger.error(
        `[ensureDirectory] Failed to create directory: ${dirPath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get storage path for client
   */
  getClientPath(domain: string): string {
    const sanitizedDomain = this.sanitizePathComponent(domain);
    return path.join(this.storagePath, sanitizedDomain);
  }

  /**
   * Get storage path for image
   */
  getImagePath(domain: string, imageId: string): string {
    const sanitizedImageId = this.sanitizePathComponent(imageId);
    return path.join(this.getClientPath(domain), 'images', sanitizedImageId);
  }

  /**
   * Get default fallback image path
   */
  getDefaultImagePath(type: 'not_found' | 'permission_denied'): string {
    const filename =
      type === 'not_found'
        ? 'fileharbor_not_found.webp'
        : 'fileharbor_permission_denided.webp';
    return path.join(this.storagePath, 'defaults.fileharbor', filename);
  }

  /**
   * Get default fallback image buffer
   */
  async getDefaultImage(
    type: 'not_found' | 'permission_denied',
  ): Promise<Buffer> {
    const imagePath = this.getDefaultImagePath(type);
    try {
      return await fs.readFile(imagePath);
    } catch (error) {
      this.logger.error(
        `[getDefaultImage] Failed to read default image: ${imagePath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException('Failed to load default image');
    }
  }

  /**
   * Get full file path for image variant
   */
  getImageFilePath(
    domain: string,
    imageId: string,
    variant: 'original' | 'thumb' = 'original',
  ): string {
    return `${this.getImagePath(domain, imageId)}/${variant}.webp`;
  }

  /**
   * Get storage path for avatar
   */
  getAvatarPath(domain: string, creatorId: string): string {
    const sanitizedCreatorExternalId = this.sanitizePathComponent(creatorId);
    return path.join(
      this.getClientPath(domain),
      'avatars',
      sanitizedCreatorExternalId,
    );
  }

  /**
   * Get full file path for avatar variant
   */
  getAvatarFilePath(
    domain: string,
    creatorId: string,
    variant: 'original' | 'thumb' = 'original',
  ): string {
    return `${this.getAvatarPath(domain, creatorId)}/${variant}.webp`;
  }

  /**
   * Save file to storage
   */
  async saveFile(filePath: string, buffer: Buffer): Promise<void> {
    try {
      this.validatePath(filePath);
      const dir = path.dirname(filePath);
      await this.ensureDirectory(dir);
      await fs.writeFile(filePath, buffer);
    } catch (error) {
      this.logger.error(
        `[saveFile] Failed to save file: ${filePath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Read file from storage
   */
  async readFile(filePath: string): Promise<Buffer> {
    try {
      this.validatePath(filePath);
      return await fs.readFile(filePath);
    } catch (error) {
      this.logger.error(
        `[readFile] Failed to read file: ${filePath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Delete directory recursively
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      // Validate path is within storage directory before deletion
      this.validatePath(dirPath);
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.error(
        `[deleteDirectory] Failed to delete directory: ${dirPath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to delete directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all directories in a path
   */
  async listDirectories(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      // If directory doesn't exist or is not accessible, return empty array
      return [];
    }
  }

  /**
   * Get all client domains from storage
   */
  async getAllClientDomains(): Promise<string[]> {
    return this.listDirectories(this.storagePath);
  }

  /**
   * Get all image IDs for a client domain
   */
  async getClientImageIds(domain: string): Promise<string[]> {
    const imagesPath = path.join(this.getClientPath(domain), 'images');
    return this.listDirectories(imagesPath);
  }

  /**
   * Get all avatar creator IDs for a client domain
   */
  async getClientAvatarCreatorExternalIds(domain: string): Promise<string[]> {
    const avatarsPath = path.join(this.getClientPath(domain), 'avatars');
    return this.listDirectories(avatarsPath);
  }

  getVideoPath(domain: string, videoId: string): string {
    const sanitizedVideoId = this.sanitizePathComponent(videoId);
    return path.join(this.getClientPath(domain), 'videos', sanitizedVideoId);
  }

  getVideoFilePath(
    domain: string,
    videoId: string,
    variant: 'original' | 'thumb' = 'original',
  ): string {
    const ext = variant === 'original' ? 'mp4' : 'webp';
    return `${this.getVideoPath(domain, videoId)}/${variant}.${ext}`;
  }

  async getClientVideoIds(domain: string): Promise<string[]> {
    const videosPath = path.join(this.getClientPath(domain), 'videos');
    return this.listDirectories(videosPath);
  }

  async copyFromTemp(srcPath: string, destPath: string): Promise<void> {
    try {
      this.validatePath(destPath);
      const dir = path.dirname(destPath);
      await this.ensureDirectory(dir);
      await fs.copyFile(srcPath, destPath);
    } catch (error) {
      this.logger.error(
        `[copyFromTemp] Failed: ${destPath}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to store file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async extractVideoThumbnail(
    videoPath: string,
    outputPath: string,
    quality: number = 80,
  ): Promise<void> {
    const tmpJpeg = path.join(os.tmpdir(), `${uuidv4()}.jpg`);
    const FFMPEG_TIMEOUT_MS = 30_000;

    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          fluentFfmpeg(videoPath)
            .screenshots({
              timestamps: ['00:00:00'],
              filename: path.basename(tmpJpeg),
              folder: path.dirname(tmpJpeg),
              size: '640x?',
            })
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err));
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('ffmpeg thumbnail extraction timed out')),
            FFMPEG_TIMEOUT_MS,
          ),
        ),
      ]);

      const jpegBuffer = await fs.readFile(tmpJpeg);
      const webpBuffer = await openImage(jpegBuffer)
        .webp({ quality })
        .toBuffer();
      await this.saveFile(outputPath, webpBuffer);
    } catch (error) {
      this.logger.error(
        `[extractVideoThumbnail] Failed: ${error instanceof Error ? error.message : error}`,
      );
      throw new InternalServerErrorException(
        `Failed to extract thumbnail: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      await fs.unlink(tmpJpeg).catch(() => {});
    }
  }

  async getVideoMetadata(
    videoPath: string,
  ): Promise<{ duration: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      fluentFfmpeg.ffprobe(videoPath, (err: Error | null, data: any) => {
        if (err) return reject(err);
        const videoStream = data.streams?.find(
          (s: any) => s.codec_type === 'video',
        );
        resolve({
          duration: Math.round(data.format?.duration ?? 0),
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
        });
      });
    });
  }

  /**
   * Convert image to WebP
   */
  async convertToWebP(
    inputBuffer: Buffer,
    quality: number = 85,
  ): Promise<Buffer> {
    try {
      return await openImage(inputBuffer).webp({ quality }).toBuffer();
    } catch (error) {
      this.logger.error(
        `[convertToWebP] Failed to convert image to WebP`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to convert image to WebP: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Create thumbnail with flexible sizing and format options
   */
  async createThumbnail(
    inputBuffer: Buffer,
    maxSize: number = 800,
    quality: number = 85,
    options: {
      width?: number;
      height?: number;
      format?: 'webp' | 'jpeg' | 'png';
      maintainAspectRatio?: boolean;
    } = {},
  ): Promise<Buffer> {
    try {
      const {
        width = maxSize,
        height = maxSize,
        format = 'webp',
        maintainAspectRatio = true,
      } = options;

      let pipeline = openImage(inputBuffer);

      // Apply resizing with more flexible options
      pipeline = pipeline.resize(width, height, {
        fit: maintainAspectRatio ? 'inside' : 'fill',
        withoutEnlargement: true,
        background:
          format === 'jpeg'
            ? { r: 255, g: 255, b: 255, alpha: 1 }
            : { r: 0, g: 0, b: 0, alpha: 0 },
      });

      // Apply format-specific compression
      switch (format) {
        case 'jpeg':
          return await pipeline
            .jpeg({
              quality,
              progressive: true,
              mozjpeg: true, // Better compression
            })
            .toBuffer();
        case 'png':
          return await pipeline
            .png({
              quality,
              progressive: true,
              compressionLevel: 9,
            })
            .toBuffer();
        default:
          return await pipeline
            .webp({
              quality,
              effort: 6, // Better compression
            })
            .toBuffer();
      }
    } catch (error) {
      this.logger.error(
        `[createThumbnail] Failed to create thumbnail`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to create thumbnail: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get image metadata
   */
  async getImageMetadata(buffer: Buffer): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    const metadata = await openImage(buffer)
      .metadata()
      // Also rejects dimensions over MAX_INPUT_PIXELS, from the header alone.
      .catch((error: unknown) => {
        this.logger.warn(
          `[getImageMetadata] Unreadable image: ${error instanceof Error ? error.message : error}`,
        );
        throw new BadRequestException('Invalid or corrupted image file');
      });
    // The client-supplied MIME type proves nothing: check what the bytes are.
    if (!SUPPORTED_IMAGE_FORMATS.includes(metadata.format ?? '')) {
      throw new BadRequestException(
        `Unsupported image format: ${metadata.format ?? 'unknown'}`,
      );
    }
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format,
      size: buffer.length,
    };
  }

  /**
   * Remove EXIF data and optimize image
   * Removes sensitive metadata while preserving color profiles and orientation
   * Uses advanced WebP compression with optimal settings
   */
  async optimizeImage(buffer: Buffer, quality: number = 90): Promise<Buffer> {
    try {
      const metadata = await openImage(buffer).metadata();

      // Prepare the image pipeline
      let pipeline = openImage(buffer);

      // Auto-rotate based on EXIF orientation
      pipeline = pipeline.rotate();

      // Strip all metadata except color profile
      // This removes EXIF, GPS, and other sensitive data while keeping color accuracy
      const metadataOptions: any = {
        exif: {}, // Remove all EXIF data including GPS
      };

      // Preserve orientation if available
      if (metadata.orientation) {
        metadataOptions.orientation = metadata.orientation;
      }

      // Preserve color space if available
      if (metadata.space) {
        metadataOptions.space = metadata.space;
      }

      pipeline = pipeline.withMetadata(metadataOptions);

      // Apply advanced WebP compression
      return await pipeline
        .webp({
          quality,
          effort: 6, // Higher effort = better compression (0-6, default 4)
          lossless: false,
          nearLossless: false,
          smartSubsample: true, // Better chroma subsampling
          alphaQuality: 100, // Keep alpha channel quality high
          mixed: true, // Allow mixed lossy/lossless encoding for better results
        })
        .toBuffer();
    } catch (error) {
      // Provide more detailed error information
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new InternalServerErrorException(
        `Failed to optimize image: ${errorMessage}. The image may be corrupted or in an unsupported format.`,
      );
    }
  }

  /**
   * Resize image on-demand
   */
  async resizeImage(
    buffer: Buffer,
    width?: number,
    height?: number,
    format: 'webp' | 'jpeg' | 'png' = 'webp',
    quality: number = 85,
  ): Promise<Buffer> {
    try {
      let pipeline = openImage(buffer);

      if (width || height) {
        pipeline = pipeline.resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      switch (format) {
        case 'jpeg':
          return await pipeline.jpeg({ quality }).toBuffer();
        case 'png':
          return await pipeline.png({ quality }).toBuffer();
        default:
          return await pipeline.webp({ quality }).toBuffer();
      }
    } catch (error) {
      this.logger.error(
        `[resizeImage] Failed to resize image`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        `Failed to resize image: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
