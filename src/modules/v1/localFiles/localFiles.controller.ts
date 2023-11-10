import {
    Controller,
    Get,
    Param,
    UseInterceptors,
    ClassSerializerInterceptor,
    StreamableFile,
    Res, Logger,
} from '@nestjs/common';
import LocalFilesService from './localFiles.service';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';

@Controller()
@UseInterceptors(ClassSerializerInterceptor)
export default class LocalFilesController {
    constructor(private readonly localFilesService: LocalFilesService) {}
    private readonly logger = new Logger(LocalFilesController.name);

    @Get()
    async getAllFiles() {
        return this.localFilesService.getAllFiles();
    }

    @Get(':id')
    async getDatabaseFileById(
        @Param('id') id: string,
        @Res({ passthrough: true }) response: Response,
    ) {
        this.logger.log(`Received request for file with id: ${id}`);
        const file = await this.localFilesService.getFileById(id);

        const stream = createReadStream(join(process.cwd(), file.path));

        response.set({
            'Content-Disposition': `inline; filename="${file.filename}"`,
            'Content-Type': file.mimetype,
        });
        return new StreamableFile(stream);
    }
}
