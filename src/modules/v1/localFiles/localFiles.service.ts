import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { unlink } from 'fs';
import { LocalFileDto } from './dto/local-file.dto';
import { plainToInstance } from 'class-transformer';

@Injectable()
class LocalFilesService {
  constructor(private prisma: PrismaService) {}

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
      description: string;
      tags: string[];
      type: string;
      ownerId: string;
    },
  ) {
    return this.saveFile({
      id: file.filename,
      path: file.path,
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
}

export default LocalFilesService;
