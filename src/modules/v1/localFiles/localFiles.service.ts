import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { LocalFile } from '@prisma/client';

@Injectable()
class LocalFilesService {
    constructor(
        private prisma: PrismaService,
    ) {}

    async saveFile(data: LocalFile): Promise<LocalFile> {
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
}

export default LocalFilesService;
