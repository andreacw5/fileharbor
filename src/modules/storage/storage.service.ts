import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as sharp from 'sharp';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storagePath: string;

  constructor(private configService: ConfigService) {
    this.storagePath = this.configService.get<string>('STORAGE_PATH') || './storage';
  }

  /**
   * Validate that a path is within the storage directory
   * Prevents directory traversal attacks
   */
  private validatePath(targetPath: string): void {
    const normalizedTarget = path.resolve(targetPath);
    const normalizedStorage = path.resolve(this.storagePath);

    if (!normalizedTarget.startsWith(normalizedStorage)) {
      this.logger.error(`[validatePath] Path traversal attempt detected: ${targetPath}`);
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
      .replace(/\.\./g, '_')  // Block parent directory traversal
      .replace(/[/\\\0]/g, '_');  // Block path separators and null bytes
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      this.validatePath(dirPath);
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      this.logger.error(`[ensureDirectory] Failed to create directory: ${dirPath}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const filename = type === 'not_found'
      ? 'fileharbor_not_found.webp'
      : 'fileharbor_permission_denided.webp';
    return path.join(this.storagePath, 'defaults.fileharbor', filename);
  }

  /**
   * Get default fallback image buffer
   */
  async getDefaultImage(type: 'not_found' | 'permission_denied'): Promise<Buffer> {
    const imagePath = this.getDefaultImagePath(type);
    try {
      return await fs.readFile(imagePath);
    } catch (error) {
      this.logger.error(`[getDefaultImage] Failed to read default image: ${imagePath}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to load default image');
    }
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
    const sanitizedUserId = this.sanitizePathComponent(userId);
    return path.join(this.getClientPath(domain), 'avatars', sanitizedUserId);
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
      this.validatePath(filePath);
      const dir = path.dirname(filePath);
      await this.ensureDirectory(dir);
      await fs.writeFile(filePath, buffer);
    } catch (error) {
      this.logger.error(`[saveFile] Failed to save file: ${filePath}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[readFile] Failed to read file: ${filePath}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[deleteDirectory] Failed to delete directory: ${dirPath}`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to delete directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[convertToWebP] Failed to convert image to WebP`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to convert image to WebP: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[createThumbnail] Failed to create thumbnail`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to create thumbnail: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[getImageMetadata] Failed to get image metadata`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to get image metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.logger.error(`[resizeImage] Failed to resize image`, error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException(`Failed to resize image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
