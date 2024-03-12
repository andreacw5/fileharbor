import {Injectable, Logger, NotFoundException} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { LocalFile } from '@prisma/client';
import * as fs from "fs";

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

    async optimizeImage(path: string) {
        // Transform image to webp
        const image = fs.readFileSync(path);
        Logger.debug(`Optimizing image ${path}`);
/*        const webp = await sharp(image).webp({
            quality: 60,
            lossless: true,
        }).toBuffer();*/
    }

    async tinyPngCompression(path: string) {
        // Execute API Call to TinyPNG

        // Download optimized file
    }

    addFile(file: Express.Multer.File) {
        return this.saveFile({
            id: file.filename,
            path: file.path,
            filename: file.originalname,
            mimetype: file.mimetype,
        });
    }
}

export default LocalFilesService;
