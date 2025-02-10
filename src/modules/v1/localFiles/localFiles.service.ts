import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { unlink } from 'fs';
import { LocalFileDto } from './dto/local-file.dto';
import { plainToInstance } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as sharp from 'sharp';
import { join } from 'path';
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
   * @param {string} path
   */
  async deleteFileByPath(path: string) {
    unlink(path, (err) => {
      if (err) throw err;
    });
  }

  /**
   * Moves a file to a domain folder
   * @param {string} filePath
   * @param {string} domain
   */
  async moveFileToDomainFolder(filePath: string, domain: string) {
    // Check if the domain folder exists
    const domainFolder = join(process.cwd(), `./uploads/${domain}`);

    // Create the domain folder if it doesn't exist
    await fs.mkdir(domainFolder, { recursive: true });

    // Move the file to the domain folder
    const newPath = join(domainFolder, filePath.split('/').pop());

    // Rename the file
    await fs.rename(filePath, newPath);

    this.logger.log(`Moved file to domain folder: ${newPath}`);
  }

  /**
   * Optimizes all files in the database
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async optimizeFiles() {
    this.logger.log('Starting optimization job');
    const files = await this.prisma.localFile.findMany({
      where: {
        optimized: false,
      },
    });

    for (const file of files) {
      try {
        // Get the file path and the temporary WebP path
        const filePath = join(process.cwd(), file.path);
        const tmpDir = join(process.cwd(), './uploads/tmp');
        const tmpFilePath = join(tmpDir, file.id);

        // Ensure the temporary directory exists
        await fs.mkdir(tmpDir, { recursive: true });

        // Convert the file to WebP format
        await sharp(filePath).webp({ effort: 3 }).toFile(tmpFilePath);

        // Delete the original file
        await fs.unlink(filePath);

        // Move the optimized file to the original path
        await fs.rename(tmpFilePath, filePath);

        // Update the file path and optimized status in the database
        await this.prisma.localFile.update({
          where: { id: file.id },
          data: {
            size: (await fs.stat(filePath)).size,
            mimetype: 'image/webp',
            optimized: true,
          },
        });

        this.logger.log(`Optimized file: ${file.filename}`);
      } catch (error) {
        this.logger.error(`Failed to optimize file: ${file.filename}`, error);
      }
    }
  }
}

export default LocalFilesService;
