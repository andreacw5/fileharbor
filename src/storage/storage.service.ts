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
   * Get storage path for avatar
   */
  getAvatarPath(domain: string, userId: string): string {
    return path.join(this.getClientPath(domain), 'avatars', userId);
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
   * Delete file from storage
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        throw new InternalServerErrorException('Failed to delete file');
      }
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
   * Create thumbnail
   */
  async createThumbnail(
    inputBuffer: Buffer,
    maxSize: number = 800,
    quality: number = 85
  ): Promise<Buffer> {
    try {
      return await sharp(inputBuffer)
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer();
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
   * Remove EXIF data and optimize
   */
  async optimizeImage(buffer: Buffer, quality: number = 90): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .rotate() // Auto-rotate based on EXIF
        .withMetadata({
          exif: {},  // Remove EXIF data
        })
        .webp({ quality })
        .toBuffer();
    } catch (error) {
      throw new InternalServerErrorException('Failed to optimize image');
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

