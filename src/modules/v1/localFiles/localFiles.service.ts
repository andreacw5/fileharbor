import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { LocalFile } from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { unlink } from 'fs';

@Injectable()
class LocalFilesService {
  constructor(
    private prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Saves a file to the database
   * @param data
   */
  async saveFile(data: {
    path: string;
    filename: string;
    description: string;
    mimetype: string;
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
   */
  async getAllFiles(): Promise<LocalFile[]> {
    return this.prisma.localFile.findMany({});
  }

  /**
   * Adds a file to the database
   * @param file
   * @param content
   */
  addFile(
    file: Express.Multer.File,
    content: { description: string; tags: string[]; type: string },
  ) {
    return this.saveFile({
      id: file.filename,
      path: file.path,
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
    unlink(file.path, (err) => {
      if (err) throw err;
    });
    return this.deleteFile(id);
  }
}

export default LocalFilesService;
