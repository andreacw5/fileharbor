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
import { ClientInterceptor } from '@/client/interceptors/client.interceptor';
import { ClientId } from '@/client/decorators/client.decorator';
import { Public } from '@/client/decorators/public.decorator';
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
  constructor(private avatarService: AvatarService) {}

  @Post()
  @ApiOperation({
    summary: 'Upload or update user avatar',
    description: 'Upload new avatar or update existing one for a user. Auto-converts to WebP, creates thumbnail, and optimizes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  @ApiResponse({ status: 201, type: AvatarResponseDto, description: 'Avatar uploaded successfully' })
  @ApiResponse({ status: 400, description: 'No file uploaded, invalid format, or missing externalUserId' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-API-Key header' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @ClientId() clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('externalUserId') externalUserId: string,
  ): Promise<AvatarResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!externalUserId) {
      throw new BadRequestException('externalUserId is required in form data');
    }

    return this.avatarService.uploadAvatar(clientId, file, externalUserId);
  }

  @Public()
  @Get(':externalUserId')
  @ApiOperation({
    summary: 'Get user avatar (public endpoint)',
    description: 'Retrieve user avatar by external user ID. Query parameters: info (return JSON metadata), thumb (return thumbnail), download (force download)',
  })
  @ApiResponse({ status: 200, description: 'Avatar file or metadata' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  async getAvatar(
    @Param('externalUserId') externalUserId: string,
    @Query() query: GetAvatarDto,
    @Res() res: Response,
  ) {
    // If info mode, return metadata as JSON
    if (query.info) {
      const avatar = await this.avatarService.getAvatarByExternalUserId(externalUserId);
      const metadata = this.avatarService.getAvatarMetadata(avatar, externalUserId);
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
      'ETag': `"avatar-${externalUserId}${query.thumb ? '-thumb' : ''}"`,
    };

    if (query.download) {
      const filename = `avatar-${externalUserId}${query.thumb ? '-thumb' : ''}.webp`;
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    res.set(headers);
    res.send(buffer);
  }

  @Delete(':externalUserId')
  @ApiOperation({
    summary: 'Delete user avatar',
    description: 'Delete the avatar for a specific user. Requires only API key authentication.',
  })
  @ApiResponse({ status: 200, type: DeleteAvatarResponseDto, description: 'Avatar deleted successfully' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-API-Key header' })
  async deleteAvatar(
    @ClientId() clientId: string,
    @Param('externalUserId') externalUserId: string,
  ): Promise<DeleteAvatarResponseDto> {
    if (!externalUserId) {
      throw new BadRequestException('externalUserId is required in path');
    }

    return this.avatarService.deleteAvatar(clientId, externalUserId);
  }
}

