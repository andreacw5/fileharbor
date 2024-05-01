import { UsersService } from './users.service';
import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Express } from 'express';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from '../localFiles/localFiles.interceptor';
import {
  ApiBasicAuth,
  ApiBody,
  ApiConsumes,
  ApiHeaders,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CreateAnAvatarDto } from './dto/create-an-avatar.dto';

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
  @UseInterceptors(
    LocalFilesInterceptor({
      fieldName: 'file',
      path: AVATAR_UPLOADS_DIR,
      fileFilter: (request, file, callback) => {
        if (!request.body.externalId || !request.body.domain) {
          return callback(
            new BadRequestException('No external id or domain provided'),
            false,
          );
        }
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
    this.logger.log(
      `Received new avatar file: ${file.originalname} for id ${createAnAvatarDto.externalId}`,
    );
    const uploaded = await this.usersService.addFile(
      file,
      createAnAvatarDto.description || 'User avatar',
      createAnAvatarDto.tags || ['avatar'],
    );
    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/files/${uploaded.id}`,
    };
  }
}
