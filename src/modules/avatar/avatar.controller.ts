import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AvatarService } from './avatar.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { ClientId } from '@/modules/client/decorators/client.decorator';
import { Public } from '@/modules/client/decorators/public.decorator';
import {
  UploadAvatarDto,
  AvatarResponseDto,
  GetAvatarDto,
  DeleteAvatarResponseDto,
} from './dto';

@ApiTags('Avatars')
@ApiSecurity('api-key')
@Controller('avatars')
@UseInterceptors(ClientInterceptor)
export class AvatarController {
  private readonly logger = new Logger(AvatarController.name);

  constructor(private avatarService: AvatarService) {}

  @Post()
  @ApiOperation({
    summary: 'Upload or update creator avatar',
    description:
      'Upload new avatar or update existing one for a creator. Auto-converts to WebP, creates thumbnail, and optimizes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  @ApiResponse({
    status: 201,
    type: AvatarResponseDto,
    description: 'Avatar uploaded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'No file uploaded, invalid format, or missing externalUserId',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @ClientId() clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('externalUserId') externalUserId: string,
  ): Promise<AvatarResponseDto> {
    if (!file) {
      this.logger.warn(
        `[uploadAvatar] No file provided - Client: ${clientId}, Creator: ${externalUserId}`,
      );
      throw new BadRequestException('No file uploaded');
    }

    if (!externalUserId) {
      this.logger.warn(
        `[uploadAvatar] Missing externalUserId - Client: ${clientId}`,
      );
      throw new BadRequestException('externalUserId is required in form data');
    }

    this.logger.debug(
      `[uploadAvatar] Starting - Client: ${clientId}, Creator: ${externalUserId}, File: ${file.originalname} (${file.size} bytes), MIME: ${file.mimetype}`,
    );

    try {
      const result = await this.avatarService.uploadAvatar(
        clientId,
        file,
        externalUserId,
      );
      this.logger.log(
        `[uploadAvatar] Success - Client: ${clientId}, Creator: ${externalUserId}, Size: ${file.size} bytes`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[uploadAvatar] Failed - Client: ${clientId}, Creator: ${externalUserId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Public()
  @Get(':externalUserId')
  @ApiOperation({
    summary: 'Get creator avatar (public endpoint)',
    description:
      'Retrieve creator avatar by external creator ID. Query parameters: info (return JSON metadata), thumb (return thumbnail), download (force download), t (timestamp for cache busting)',
  })
  @ApiResponse({ status: 200, description: 'Avatar file or metadata' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  async getAvatar(
    @Param('externalUserId') externalUserId: string,
    @Query() query: GetAvatarDto,
    @Res() res: Response,
  ) {
    this.logger.debug(
      `[getAvatar] Starting - Creator: ${externalUserId}, Info: ${query.info}, Thumb: ${query.thumb}, Download: ${query.download}`,
    );

    try {
      // If info mode, return metadata as JSON
      if (query.info) {
        const avatar =
          await this.avatarService.getAvatarByExternalId(externalUserId);
        const metadata = this.avatarService.getAvatarMetadata(
          avatar,
          externalUserId,
        );
        this.logger.log(
          `[getAvatar] Metadata returned - Creator: ${externalUserId}`,
        );
        return res.json(metadata);
      }

      // Otherwise return the file
      const { buffer, mimeType } = await this.avatarService.getAvatarFile(
        externalUserId,
        query.thumb,
      );

      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400',
        ETag: `"avatar-${externalUserId}${query.thumb ? '-thumb' : ''}"`,
      };

      if (query.download) {
        const filename = `avatar-${externalUserId}${query.thumb ? '-thumb' : ''}.webp`;
        headers['Content-Disposition'] = `attachment; filename="${filename}"`;
        this.logger.debug(`[getAvatar] Download - Creator: ${externalUserId}`);
      } else {
        this.logger.debug(
          `[getAvatar] View - Creator: ${externalUserId}, Thumb: ${query.thumb}`,
        );
      }

      this.logger.log(
        `[getAvatar] Success - Creator: ${externalUserId}, Thumb: ${query.thumb}, Size: ${buffer.length} bytes`,
      );

      res.set(headers);
      res.send(buffer);
    } catch (error) {
      this.logger.error(
        `[getAvatar] Failed - Creator: ${externalUserId}, Error: ${error.message}`,
      );
      throw error;
    }
  }

  @Delete(':externalUserId')
  @ApiOperation({
    summary: 'Delete creator avatar',
    description:
      'Delete the avatar for a specific creator. Requires only API key authentication.',
  })
  @ApiResponse({
    status: 200,
    type: DeleteAvatarResponseDto,
    description: 'Avatar deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  async deleteAvatar(
    @ClientId() clientId: string,
    @Param('externalUserId') externalUserId: string,
  ): Promise<DeleteAvatarResponseDto> {
    if (!externalUserId) {
      this.logger.warn(
        `[deleteAvatar] Missing externalUserId - Client: ${clientId}`,
      );
      throw new BadRequestException('externalUserId is required in path');
    }

    this.logger.debug(
      `[deleteAvatar] Starting - Client: ${clientId}, Creator: ${externalUserId}`,
    );

    try {
      const result = await this.avatarService.deleteAvatar(
        clientId,
        externalUserId,
      );
      this.logger.log(
        `[deleteAvatar] Success - Client: ${clientId}, Creator: ${externalUserId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[deleteAvatar] Failed - Client: ${clientId}, Creator: ${externalUserId}, Error: ${error.message}`,
      );
      throw error;
    }
  }
}
