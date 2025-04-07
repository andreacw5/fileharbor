import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete, Get, HttpStatus,
  Logger,
  Param, Post, Res, StreamableFile, UnauthorizedException, UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation, ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import OwnersService from '../owners/owners.service';
import { AvatarsService } from './avatars.service';
import { AuthGuard } from '@nestjs/passport';
import { Express, Response } from 'express';
import { AssetsService } from '../assets/assets.service';
import { CreateAnAvatarDto } from './dto/create-an-avatar.dto';
import { AvatarDto } from './dto/avatar.dto';
import { join } from 'path';
import { createReadStream } from 'fs';
import AvatarInterceptor from './avatar.interceptor';

@Controller()
@ApiTags('Avatars')
@UseInterceptors(ClassSerializerInterceptor)
export class AvatarsController {
  constructor(
    private readonly avatarService: AvatarsService,
    private readonly configService: ConfigService,
    private readonly ownerService: OwnersService,
    private readonly assetsService: AssetsService,
  ) {}
  private readonly logger = new Logger(AvatarsController.name);

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
  async getAvatars() {
    this.logger.log('Received a request to get all files');
    return this.avatarService.getAllAvatars({});
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a file by id' })
  async getAvatarById(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const start = Date.now();
    this.logger.debug(`Received request for file with id: ${id}`);

    const file = await this.avatarService.getAvatarById(id);

    if (!file) {
      this.logger.error(`File with id: ${id} not found`);
      response.status(HttpStatus.NOT_FOUND).send('File not found');
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
    this.avatarService.updateViews(id).catch((err) => {
      this.logger.error(`Failed to update views for file with id: ${id}`, err);
    });

    return new StreamableFile(stream);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a new avatar file' })
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateAnAvatarDto })
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
    AvatarInterceptor({
      fieldName: 'file',
      path: './uploads/avatars',
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
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Body() createAnAvatarDto: CreateAnAvatarDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!createAnAvatarDto.externalId || !createAnAvatarDto.domain) {
      this.logger.error(
        `No external id or domain provided for file: ${file.originalname}`,
      );
      // Remove the uploaded file
      await this.assetsService.deleteFileByPath(file.path, true, createAnAvatarDto.domain);
      throw new BadRequestException('No external id or domain provided');
    }

    this.logger.log(
      `Received new avatar file: ${file.originalname} for id ${createAnAvatarDto.externalId} and domain ${createAnAvatarDto.domain}`,
    );

    // Retrive or create a file owner
    const owner = await this.ownerService.getOwnerOrCreate({
      externalId: createAnAvatarDto.externalId,
      domain: createAnAvatarDto.domain,
    });

    if (!owner) {
      // Remove the uploaded file
      await this.assetsService.deleteFileByPath(file.path, true, createAnAvatarDto.domain);
      throw new UnauthorizedException(
        'Unable to find or create an owner for the file',
      );
    }

    // Move the file to the domain folder
    await this.assetsService.moveFileToDomainFolder(
      file.path,
      owner.domain,
      true
    );

    const uploaded: AvatarDto = await this.avatarService.createAnAvatar({
      path: 'uploads/avatars/' + owner.domain + '/' + file.filename,
      description: createAnAvatarDto.description,
      ownerId: owner.id,
      mimetype: file.mimetype,
      size: file.size,
      filename: file.originalname,
    });

    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/avatars/${uploaded.id}`,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file by id' })
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async deleteAvatar(@Param('id') id: string) {
    this.logger.log(`Received a request to delete file with id: ${id}`);
    return this.avatarService.deleteAvatarById(id);
  }

}
