import { UsersService } from './users.service';
import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Express } from 'express';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from '../localFiles/localFiles.interceptor';
import {
  ApiBadRequestResponse,
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CreateAnAvatarDto } from './dto/create-an-avatar.dto';
import OwnersService from '../owners/owners.service';
import LocalFilesService from '../localFiles/localFiles.service';

const AVATAR_UPLOADS_DIR: string = './uploads/avatars/';

@Controller()
@ApiTags('Users')
@ApiBasicAuth('api-key')
@UseGuards(AuthGuard('api-key'))
@ApiConsumes('multipart/form-data')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly localFilesService: LocalFilesService,
    private readonly ownerService: OwnersService,
  ) {}
  private readonly logger = new Logger(UsersController.name);

  /**
   * Uploads a new avatar file and overwrites the old one
   * @param file
   * @param {CreateAnAvatarDto} createAnAvatarDto
   */
  @Post('avatar')
  @ApiOperation({ summary: 'Upload a new avatar file' })
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        externalId: { type: 'string' },
        domain: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string', default: 'avatar' },
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
      path: AVATAR_UPLOADS_DIR,
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
  async addAvatar(
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
      await this.localFilesService.deleteFileByPath(file.path);
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
      await this.localFilesService.deleteFileByPath(file.path);
      throw new UnauthorizedException(
        'Unable to find or create an owner for the file',
      );
    }

    const uploaded = await this.usersService.addFile(
      file,
      createAnAvatarDto.description || 'User avatar',
      createAnAvatarDto.tags || ['avatar'],
      owner.id,
    );
    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/files/${uploaded.id}`,
    };
  }
}
