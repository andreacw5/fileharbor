import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { unlink } from 'fs';
import { LocalFileDto } from './dto/local-file.dto';
import { plainToInstance } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as sharp from 'sharp';
import { basename, join, resolve, sep } from 'path';
import { promises as fs } from 'fs';

@Injectable()
class LocalFilesService {
  constructor(private prisma: PrismaService) {}
  private readonly logger = new Logger(LocalFilesService.name);

  /**
   * Saves a file to the database
   * @param data
   */
  async saveFile(data: {
    path: string;
    filename: string;
    description: string;
    ownerId: string;
    mimetype: string;
    size: number;
    id: string;
    type: string;
    tags: string[];
  }) {
    return this.prisma.localFile.create({
      data,
    });
  }

  /**
   * Updates the views of a file by its id
   * @param id
   */
  async updateViews(id: string) {
    return this.prisma.localFile.update({
      where: { id },
      data: {
        views: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Updates the downloads of a file by its id
   * @param id
   */
  async updateDownloads(id: string) {
    return this.prisma.localFile.update({
      where: { id },
      data: {
        downloads: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Gets a file by its id
   * @param id
   */
  async getFileById(id: string) {
    return this.prisma.localFile.findUnique({ where: { id: id } });
  }

  /**
   * Gets all files
   * @param filters
   */
  async getAllFiles(filters: object): Promise<LocalFileDto[]> {
    const files = await this.prisma.localFile.findMany({
      where: filters,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            domain: true,
            externalId: true,
          },
        },
      },
    });

    return plainToInstance(LocalFileDto, files);
  }

  /**
   * Adds a file to the database
   * @param file
   * @param content
   */
  addFile(
    file: Express.Multer.File,
    content: {
      path: string;
      description: string;
      tags: string[];
      type: string;
      ownerId: string;
    },
  ) {
    return this.saveFile({
      id: file.filename,
      path: content.path,
      size: file.size,
      ownerId: content.ownerId,
      filename: file.originalname,
      mimetype: file.mimetype,
      description: content.description,
      tags: content.tags,
      type: content.type,
    });
  }

  /**
   * Deletes a file by its id
   * @param id
   */
  deleteFile(id: string) {
    return this.prisma.localFile.delete({ where: { id } });
  }

  /**
   * Deletes a file by its id and removes it from the filesystem
   * @param id
   */
  async deleteFileById(id: string) {
    const file = await this.getFileById(id);
    await this.deleteFileByPath(file.path);
    return this.deleteFile(id);
  }

  /**
   * Deletes a file by its path
   * @param {string} filePath
   */
  async deleteFileByPath(filePath: string) {
    const baseDir = join(process.cwd(), 'uploads');
    const fullPath = resolve(baseDir, filePath.replace(/^uploads\//, ''));

    if (!fullPath.startsWith(baseDir + sep)) {
      throw new Error('Invalid file path');
    }

    try {
      await fs.unlink(fullPath);
      this.logger.log(`File deleted: ${fullPath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`File not found, nothing to delete: ${fullPath}`);
      } else {
        this.logger.error(`Failed to delete file: ${fullPath}`, error);
      }
    }
  }

  /**
   * Moves a file to a domain folder
   * @param {string} filePath
   * @param {string} domain
   */
  async moveFileToDomainFolder(filePath: string, domain: string) {
    const baseDir = join(process.cwd(), 'uploads');
    const fullPath = resolve(baseDir, filePath.replace(/^uploads\//, ''));

    if (!fullPath.startsWith(baseDir + sep)) {
      throw new Error('Invalid file path');
    }

    const domainFolder = join(baseDir, domain);
    const newPath = join(domainFolder, basename(fullPath));

    if (!newPath.startsWith(domainFolder + sep)) {
      throw new Error('Invalid new file path');
    }

    try {
      await fs.mkdir(domainFolder, { recursive: true }); // Ensure target directory exists
      await fs.rename(fullPath, newPath); // Move file
      this.logger.log(`Moved file to domain folder: ${newPath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger.error(`Source file does not exist: ${fullPath}`);
      } else {
        this.logger.error(`Failed to move file: ${fullPath} to ${newPath}`, error);
      }
    }
  }

  /**
   * Optimizes all files in the database
   */
  @Cron(CronExpression.EVERY_4_HOURS)
  async optimizeFiles() {
    this.logger.log('Starting optimization job');

    const files = await this.prisma.localFile.findMany({
      where: { optimized: false },
    });

    if (files.length === 0) {
      this.logger.log('No files to optimize.');
      return;
    }

    const tmpDir = join(process.cwd(), 'uploads/tmp');
    await fs.mkdir(tmpDir, { recursive: true }); // Ensure temp directory exists

    await Promise.all(files.map(async (file) => {
      const filePath = join(process.cwd(), file.path);
      const tmpFilePath = join(tmpDir, file.id);

      try {
        // Convert file to WebP format
        await sharp(filePath).webp({ effort: 3 }).toFile(tmpFilePath);

        // Replace original file with optimized version
        await fs.rename(tmpFilePath, filePath);

        // Update file metadata in the database
        const newSize = (await fs.stat(filePath)).size;
        await this.prisma.localFile.update({
          where: { id: file.id },
          data: { size: newSize, mimetype: 'image/webp', optimized: true },
        });

        this.logger.log(`Optimized file: ${file.id} from ${file.size} to ${newSize}`);
      } catch (error) {
        this.logger.error(`Failed to optimize file: ${file.id}`, error);
      }
    }));

    this.logger.log('Optimization job completed.');
  }

}

export default LocalFilesService;
