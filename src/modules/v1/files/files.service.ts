import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { plainToInstance } from 'class-transformer';
import { FileDto } from './dto/file.dto';

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
  ) {}
  private readonly logger = new Logger(FilesService.name);

  /**
   * Gets a file by its id
   * @param id
   */
  async getFileById(id: string): Promise<FileDto> {
    const file = await  this.prisma.localFile.findUnique({ where: { id: id } });

    if (!file) {
      this.logger.error(`File with id ${id} not found`);
      throw new NotFoundException(`File with id ${id} not found`);
    }

    return plainToInstance(FileDto, file);
  }

  /**
   * Gets all files
   * @param filters
   */
  async getAllFiles(filters: object): Promise<FileDto[]> {
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

    return plainToInstance(FileDto, files);
  }

  async updateFile(id: string, data: any) {
    return this.prisma.localFile.update({
      where: { id },
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
   * Saves a file to the database
   * @param data
   */
  async createAFile(data: any) {
    return this.prisma.localFile.create({
      data,
    });
  }

  /**
   * Deletes a file by its id
   * @param id
   */
  async deleteFileById(id: string) {
    return this.prisma.localFile.delete({ where: { id } });
  }

}
