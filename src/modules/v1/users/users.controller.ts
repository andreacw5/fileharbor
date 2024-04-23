import { UsersService } from './users.service';
import {
  BadRequestException,
  Controller,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Express } from 'express';
import { AuthGuard } from '@nestjs/passport';
import LocalFilesInterceptor from '../localFiles/localFiles.interceptor';
import {
  ApiBasicAuth,
  ApiConsumes,
  ApiHeaders,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

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
   * @param req
   * @param file
   */
  @Post('avatar')
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
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
  async addAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    this.logger.log(`Received new avatar file: ${file.originalname}`);
    const uploaded = await this.usersService.addFile(
      file,
      req.body.description || 'User avatar',
    );
    return {
      ...uploaded,
      fullPath: `${this.configService.get<string>('url')}/v1/files/${uploaded.id}`,
    };
  }
}
