import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get, HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res, StreamableFile, UnauthorizedException,
  UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesFilterDto } from './dto/file-filter.dto';
import {
  ApiBadRequestResponse,
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation, ApiPayloadTooLargeResponse, ApiQuery,
  ApiResponse, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { join } from 'path';
import { createReadStream } from 'fs';
import { AssetsService } from '../assets/assets.service';
import OwnersService from '../owners/owners.service';
import { ConfigService } from '@nestjs/config';
import { CreateFileDto } from './dto/create-file.dto';
import { GetLocalFileDto } from './dto/get-file.dto';
import FilesInterceptor from './files.interceptor';

@Controller()
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly assetsService: AssetsService,
    private readonly ownerService: OwnersService,
    private readonly configService: ConfigService,
  ) {}
  private readonly logger = new Logger(FilesController.name);

  @Get()
  @ApiOperation({ summary: 'Get all files' })
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
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async getAllFiles(@Req() request: { query: FilesFilterDto }) {
    const { query } = request;
    this.logger.log(`Received a new request for all files`);
    const filters = {};
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
    if (query['domain']) {
      this.logger.debug(`Filtering for domain: ${query['domain']}`);
      filters['owner'] = { domain: query['domain'] };
    }
    if (query.filename) {
      this.logger.debug(`Filtering for description: ${query.filename}`);
      filters['filename'] = { contains: query.filename };
    }
    return this.filesService.getAllFiles(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a file by id' })
  async getFileById(
    @Param('id') id: string,
    @Query() query: GetLocalFileDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const start = Date.now();
    this.logger.debug(`Received request for file with id: ${id}`);

    const file = await this.filesService.getFileById(id);

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

    // Use asynchronous file streaming
    const filePath = join(process.cwd(), file.path);
    const stream = createReadStream(filePath);

    response.set({
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Content-Type': file.mimetype,
    });

    const end = Date.now();
    this.logger.log(`File with id: ${id} sent. Duration: ${end - start}ms`);

    // Update views asynchronously
    this.filesService.updateViews(id).catch((err) => {
      this.logger.error(`Failed to update views for file with id: ${id}`, err);
    });

    return new StreamableFile(stream);
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download a file' })
  async downloadFile(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.logger.log(`Received request for file with id: ${id}`);
    const file = await this.filesService.getFileById(id);
    await this.filesService.updateDownloads(id);

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
    FilesInterceptor({
      fieldName: 'file',
      path: './uploads/files',
      fileFilter: (_request, file, callback) => {
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
        fileSize: Math.pow(2048, 2), // 2MB
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() createFileDto: CreateFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!createFileDto.externalId || !createFileDto.domain) {
      this.logger.error(
        `No external id or domain provided for file: ${file.originalname}`,
      );
      // Remove the uploaded file
      await this.assetsService.deleteFileByPath(file.path, true, createFileDto.domain);
      throw new BadRequestException('No external id or domain provided');
    }

    this.logger.log(
      `Received new file file: ${file.originalname} for id ${createFileDto.externalId} and domain ${createFileDto.domain}`,
    );

    // Retrive or create a file owner
    const owner = await this.ownerService.getOwnerOrCreate({
      externalId: createFileDto.externalId,
      domain: createFileDto.domain,
    });

    if (!owner) {
      // Remove the uploaded file
      await this.assetsService.deleteFileByPath(file.path, true, createFileDto.domain);
      throw new UnauthorizedException(
        'Unable to find or create an owner for the file',
      );
    }

    // Move the file to the domain folder
    await this.assetsService.moveFileToDomainFolder(
      file.path,
      owner.domain,
      false
    );

    const uploaded = await this.filesService.createAFile({
      path: 'uploads/files/' + owner.domain + '/' + file.filename,
      description: createFileDto.description,
      tags: createFileDto.tags,
      ownerId: owner.id,
      mimetype: file.mimetype,
      filename: file.filename,
    });
    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/files/${uploaded.id}`,
    };
  }

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
      this.logger.log(`Deleting an file with id ${id}`);
      return this.filesService.deleteFileById(id)
  }
}
