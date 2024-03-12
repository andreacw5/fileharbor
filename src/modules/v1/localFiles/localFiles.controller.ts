import {
  Controller,
  Get,
  Param,
  UseInterceptors,
  ClassSerializerInterceptor,
  StreamableFile,
  Res,
  Logger,
  UseGuards,
  Post,
  UploadedFile,
  BadRequestException, Query, Body
} from "@nestjs/common";
import LocalFilesService from './localFiles.service';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';
import { ApiBasicAuth, ApiHeaders, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from './localFiles.interceptor';
import { CacheInterceptor } from '@nestjs/cache-manager';

const GENERAL_UPLOADS_DIR: string = './uploads/';

@Controller()
@ApiTags('Files')
@UseInterceptors(ClassSerializerInterceptor)
export default class LocalFilesController {
  constructor(private readonly localFilesService: LocalFilesService) {}
  private readonly logger = new Logger(LocalFilesController.name);

  @Get()
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async getAllFiles() {
    this.logger.log(`Received a new request for all files`);
    return this.localFilesService.getAllFiles();
  }

  @Get(':id')
  @UseInterceptors(CacheInterceptor)
  async getDatabaseFileById(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.debug(`Received request for file with id: ${id}`);
    const file = await this.localFilesService.getFileById(id);

    const stream = createReadStream(join(process.cwd(), file.path));

    response.set({
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Content-Type': file.mimetype,
    });
    return new StreamableFile(stream);
  }

  @Get('download/:id')
  @UseInterceptors(CacheInterceptor)
  async downloadFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.debug(`Received request for file with id: ${id}`);
    const file = await this.localFilesService.getFileById(id);

    const stream = createReadStream(join(process.cwd(), file.path));

    response.set({
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Type': file.mimetype,
    });
    return new StreamableFile(stream);
  }

  @Post('upload')
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  @UseInterceptors(
    LocalFilesInterceptor({
      fieldName: 'file',
      path: GENERAL_UPLOADS_DIR,
      fileFilter: (request, file, callback) => {
        if (!file.mimetype.includes('image')) {
          return callback(
            new BadRequestException(
              'Image type not allowed, chose another file',
            ),
            false,
          );
        }
        callback(null, true);
      },
      limits: {
        fileSize: Math.pow(1024, 2), // 1MB
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() { description }: { description: string },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log(
      `Received and saved a new file: ${file.originalname}`,
    );
    return this.localFilesService.addFile(file, description);
  }
}
