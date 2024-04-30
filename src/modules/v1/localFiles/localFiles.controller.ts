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
  BadRequestException,
  Body,
  Delete,
} from '@nestjs/common';
import LocalFilesService from './localFiles.service';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';
import {
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from './localFiles.interceptor';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { CreateLocalFileDto } from './dto/create-local-file.dto';

const GENERAL_UPLOADS_DIR: string = './uploads/';

@Controller()
@ApiTags('Files')
@UseInterceptors(ClassSerializerInterceptor)
export default class LocalFilesController {
  constructor(
    private readonly localFilesService: LocalFilesService,
    private readonly configService: ConfigService,
  ) {}
  private readonly logger = new Logger(LocalFilesController.name);

  @Get()
  @ApiOperation({ summary: 'Get all files' })
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
  @ApiOperation({ summary: 'Get a file by id' })
  @UseInterceptors(CacheInterceptor)
  async getFileById(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.debug(`Received request for file with id: ${id}`);
    const file = await this.localFilesService.getFileById(id);
    await this.localFilesService.updateViews(id);
    const stream = createReadStream(join(process.cwd(), file.path));

    response.set({
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Content-Type': file.mimetype,
    });
    return new StreamableFile(stream);
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a file' })
  @UseInterceptors(CacheInterceptor)
  async downloadFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.log(`Received request for file with id: ${id}`);
    const file = await this.localFilesService.getFileById(id);
    await this.localFilesService.updateDownloads(id);

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
  @ApiOperation({ summary: 'Uploads a new file' })
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        type: { type: 'string', default: 'local' },
        tags: { type: 'array' },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    LocalFilesInterceptor({
      fieldName: 'file',
      path: GENERAL_UPLOADS_DIR,
      fileFilter: (request, file, callback) => {
        if (!file.mimetype.includes('image')) {
          return callback(
            new BadRequestException(
              'Image type not allowed, chose another file' + file.mimetype,
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
    @Body() createLocalFileDto: CreateLocalFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log(`Received and saved a new file: ${file.originalname}`);
    const uploaded = await this.localFilesService.addFile(file, {
      description: createLocalFileDto.description,
      tags: createLocalFileDto.tags,
      type: createLocalFileDto.type,
    });
    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/files/${uploaded.id}`,
    };
  }

  /**
   * Deletes a file by id
   * @param {string} id
   */
  @Delete(':id')
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiOperation({ summary: 'Delete a file by id' })
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async deleteFile(@Param('id') id: string) {
    this.logger.log(`Received a request to delete file with id: ${id}`);
    return this.localFilesService.deleteFileById(id);
  }
}
