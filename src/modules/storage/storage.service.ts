import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as sharp from 'sharp';

@Injectable()
export class StorageService {
  private readonly storagePath: string;

  constructor(private configService: ConfigService) {
    this.storagePath = this.configService.get<string>('STORAGE_PATH') || './storage';
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new InternalServerErrorException('Failed to create directory');
    }
  }

  /**
   * Get storage path for client
   */
  getClientPath(domain: string): string {
    return path.join(this.storagePath, domain);
  }

  /**
   * Get storage path for image
   */
  getImagePath(domain: string, imageId: string): string {
    return path.join(this.getClientPath(domain), 'images', imageId);
  }

  /**
   * Get full file path for image variant
   */
  getImageFilePath(
    domain: string,
    imageId: string,
    variant: 'original' | 'thumb' = 'original'
  ): string {
    return `${this.getImagePath(domain, imageId)}/${variant}.webp`;
  }

  /**
   * Get storage path for avatar
   */
  getAvatarPath(domain: string, userId: string): string {
    return path.join(this.getClientPath(domain), 'avatars', userId);
  }

  /**
   * Get full file path for avatar variant
   */
  getAvatarFilePath(
    domain: string,
    userId: string,
    variant: 'original' | 'thumb' = 'original'
  ): string {
    return `${this.getAvatarPath(domain, userId)}/${variant}.webp`;
  }

  /**
   * Save file to storage
   */
  async saveFile(filePath: string, buffer: Buffer): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await this.ensureDirectory(dir);
      await fs.writeFile(filePath, buffer);
    } catch (error) {
      throw new InternalServerErrorException('Failed to save file');
    }
  }

  /**
   * Read file from storage
   */
  async readFile(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new InternalServerErrorException('Failed to read file');
    }
  }

  /**
   * Delete directory recursively
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete directory');
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
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
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
   * Get all avatar user IDs for a client domain
   */
  async getClientAvatarUserIds(domain: string): Promise<string[]> {
    const avatarsPath = path.join(this.getClientPath(domain), 'avatars');
    return this.listDirectories(avatarsPath);
  }

  /**
   * Convert image to WebP
   */
  async convertToWebP(inputBuffer: Buffer, quality: number = 85): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .webp({ quality })
        .toBuffer();
    } catch (error) {
      throw new InternalServerErrorException('Failed to convert image to WebP');
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
    } = {}
  ): Promise<Buffer> {
    try {
      const {
        width = maxSize,
        height = maxSize,
        format = 'webp',
        maintainAspectRatio = true
      } = options;

      let pipeline = sharp(inputBuffer);

      // Apply resizing with more flexible options
      pipeline = pipeline.resize(width, height, {
        fit: maintainAspectRatio ? 'inside' : 'fill',
        withoutEnlargement: true,
        background: format === 'jpeg' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 }
      });

      // Apply format-specific compression
      switch (format) {
        case 'jpeg':
          return await pipeline.jpeg({
            quality,
            progressive: true,
            mozjpeg: true // Better compression
          }).toBuffer();
        case 'png':
          return await pipeline.png({
            quality,
            progressive: true,
            compressionLevel: 9
          }).toBuffer();
        default:
          return await pipeline.webp({
            quality,
            effort: 6 // Better compression
          }).toBuffer();
      }
    } catch (error) {
      throw new InternalServerErrorException('Failed to create thumbnail');
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
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'unknown',
        size: buffer.length,
      };
    } catch (error) {
      throw new InternalServerErrorException('Failed to get image metadata');
    }
  }

  /**
   * Remove EXIF data and optimize image
   * Removes sensitive metadata while preserving color profiles and orientation
   * Uses advanced WebP compression with optimal settings
   */
  async optimizeImage(buffer: Buffer, quality: number = 90): Promise<Buffer> {
    try {
      const metadata = await sharp(buffer).metadata();

      // Prepare the image pipeline
      let pipeline = sharp(buffer, {
        limitInputPixels: 268402689, // ~16384x16384 max resolution for safety
      });

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new InternalServerErrorException(
        `Failed to optimize image: ${errorMessage}. The image may be corrupted or in an unsupported format.`
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
    quality: number = 85
  ): Promise<Buffer> {
    try {
      let pipeline = sharp(buffer);

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
      throw new InternalServerErrorException('Failed to resize image');
    }
  }
}

