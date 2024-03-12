import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { LocalFile } from '@prisma/client';
import * as fs from 'fs';
import { HttpService } from '@nestjs/axios';

@Injectable()
class LocalFilesService {
  constructor(
    private prisma: PrismaService,
    private readonly httpService: HttpService,
  ) {}

  async saveFile(data: {
    path: string;
    filename: string;
    description: string;
    mimetype: string;
    id: string;
  }) {
    return this.prisma.localFile.create({
      data,
    });
  }

  async getFileById(id: string) {
    return this.prisma.localFile.findUnique({ where: { id: id } });
  }

  async getAllFiles(): Promise<LocalFile[]> {
    return this.prisma.localFile.findMany({});
  }

  addFile(file: Express.Multer.File, description: string) {
    return this.saveFile({
      id: file.filename,
      path: file.path,
      filename: file.originalname,
      mimetype: file.mimetype,
      description,
    });
  }
}

export default LocalFilesService;
