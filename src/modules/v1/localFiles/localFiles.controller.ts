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
  Req,
  UnauthorizedException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import LocalFilesService from './localFiles.service';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';
import {
  ApiBadRequestResponse,
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from './localFiles.interceptor';
import { ConfigService } from '@nestjs/config';
import { CreateLocalFileDto } from './dto/create-local-file.dto';
import { LocalFileFilterDto } from './dto/local-file-filter.dto';
import OwnersService from '../owners/owners.service';
import { GetLocalFileDto } from './dto/get-file.dto';

const GENERAL_UPLOADS_DIR: string = './uploads/';

@Controller()
@ApiTags('Files')
@UseInterceptors(ClassSerializerInterceptor)
export default class LocalFilesController {
  constructor(
    private readonly localFilesService: LocalFilesService,
    private readonly configService: ConfigService,
    private readonly ownerService: OwnersService,
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
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    example: 'local',
    enum: ['local', 'avatar'],
    description: 'Type of file',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    example: 'tag1,tag2',
    type: [String],
    description: 'Tags of the file',
  })
  @ApiQuery({
    name: 'description',
    required: false,
    example: 'Description',
    type: String,
    description: 'Description of the file',
  })
  @ApiQuery({
    name: 'filename',
    required: false,
    example: 'file.jpg',
    type: String,
    description: 'Filename of the file',
  })
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async getAllFiles(@Req() request: { query: LocalFileFilterDto }) {
    const { query } = request;
    this.logger.log(`Received a new request for all files`);
    const filters = {};
    if (query.type) {
      this.logger.debug(`Filtering for type active: ${query.type}`);
      filters['type'] = query.type;
    }
    if (query.tags) {
      this.logger.debug(`Filtering for tags: ${query.tags}`);
      if (!Array.isArray(query.tags)) {
        query.tags = [query.tags];
      }
      filters['tags'] = { hasSome: query.tags };
    }
    if (query.description) {
      this.logger.debug(`Filtering for description: ${query.description}`);
      filters['description'] = { contains: query.description };
    }
    if (query.filename) {
      this.logger.debug(`Filtering for description: ${query.filename}`);
      filters['filename'] = { contains: query.filename };
    }
    return this.localFilesService.getAllFiles(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a file by id' })
  @ApiParam({
    name: 'id',
    description: 'Local file id',
  })
  @ApiQuery({
    name: 'token',
    required: false,
    type: String,
    description: 'Token for private files',
  })
  async getFileById(
    @Param('id') id: string,
    @Query() query: GetLocalFileDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const start = Date.now();
    this.logger.log(`Received request for file with id: ${id}`);

    // Optimize database query
    const file = await this.localFilesService.getFileById(id);

    if (!file) {
      this.logger.error(`File with id: ${id} not found`);
      response.status(HttpStatus.NOT_FOUND).send('File not found');
      return;
    }

    if (file.token !== null && query.token !== file.token) {
      this.logger.error(
        `Token mismatch for file with id: ${id} and token: ${query.token}`,
      );
      response.status(HttpStatus.UNAUTHORIZED).send('Token mismatch');
      return;
    }

    // Update views asynchronously
    this.localFilesService.updateViews(id).catch((err) => {
      this.logger.error(`Failed to update views for file with id: ${id}`, err);
    });

    // Use asynchronous file streaming
    const filePath = join(process.cwd(), file.path);
    const stream = createReadStream(filePath);

    response.set({
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Content-Type': file.mimetype,
    });

    const end = Date.now();
    this.logger.debug(`File with id: ${id} sent. Duration: ${end - start}ms`);

    return new StreamableFile(stream);
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a file' })
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
        externalId: { type: 'string' },
        domain: { type: 'string' },
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
  @ApiResponse({
    status: 201,
    description: 'The file has been successfully uploaded.',
  })
  @ApiBadRequestResponse({ description: 'No file uploaded' })
  @ApiPayloadTooLargeResponse({ description: 'File too large' })
  @ApiUnauthorizedResponse({
    description: 'Unable to find or create an owner for the file',
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
    if (!createLocalFileDto.externalId || !createLocalFileDto.domain) {
      this.logger.error(
        `No external id or domain provided for file: ${file.originalname}`,
      );
      // Remove the uploaded file
      await this.localFilesService.deleteFileByPath(file.path);
      throw new BadRequestException('No external id or domain provided');
    }

    this.logger.log(
      `Received new avatar file: ${file.originalname} for id ${createLocalFileDto.externalId} and domain ${createLocalFileDto.domain}`,
    );

    // Retrive or create a file owner
    const owner = await this.ownerService.getOwnerOrCreate({
      externalId: createLocalFileDto.externalId,
      domain: createLocalFileDto.domain,
    });

    if (!owner) {
      // Remove the uploaded file
      await this.localFilesService.deleteFileByPath(file.path);
      throw new UnauthorizedException(
        'Unable to find or create an owner for the file',
      );
    }

    const uploaded = await this.localFilesService.addFile(file, {
      description: createLocalFileDto.description,
      tags: createLocalFileDto.tags,
      type: createLocalFileDto.type,
      ownerId: owner.id,
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
