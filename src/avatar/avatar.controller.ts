import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
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
import { ClientId, UserId } from '@/client/decorators/client.decorator';
import { Public } from '@/client/decorators/public.decorator';
import {
  UploadAvatarDto,
  AvatarResponseDto,
  GetAvatarDto,
  DeleteAvatarResponseDto,
} from './dto';

@ApiTags('Avatars')
@ApiSecurity('client-id')
@Controller('avatars')
@UseInterceptors(ClientInterceptor)
export class AvatarController {
  constructor(private avatarService: AvatarService) {}

  @Post()
  @ApiOperation({ summary: 'Upload or update user avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  @ApiResponse({ status: 201, type: AvatarResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    if (!userId) {
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    return this.avatarService.uploadAvatar(clientId, file, userId);
  }

  @Public()
  @Get(':userId')
  @ApiOperation({ summary: 'Get user avatar (public endpoint)' })
  @ApiResponse({ status: 200, type: AvatarResponseDto })
  async getAvatar(
    @Param('userId') userId: string,
    @Query() query: GetAvatarDto,
    @Res() res: Response,
  ) {
    // If info mode, return metadata as JSON
    if (query.info) {
      const avatar = await this.avatarService.getAvatarByUserId(userId);
      const metadata = this.avatarService.getAvatarMetadata(avatar);
      return res.json(metadata);
    }

    // Otherwise return the file
    const { buffer, mimeType } = await this.avatarService.getAvatarFile(
      userId,
      query.thumb,
    );

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=86400',
      'ETag': `"avatar-${userId}${query.thumb ? '-thumb' : ''}"`,
    };

    if (query.download) {
      const filename = `avatar-${userId}${query.thumb ? '-thumb' : ''}.webp`;
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    res.set(headers);
    res.send(buffer);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Delete user avatar' })
  @ApiResponse({ status: 200, type: DeleteAvatarResponseDto })
  async deleteAvatar(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('userId') paramUserId: string,
  ): Promise<DeleteAvatarResponseDto> {
    if (!userId) {
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
    if (userId !== paramUserId) {
      throw new BadRequestException('User ID mismatch between header and path parameter');
    }

    return this.avatarService.deleteAvatar(clientId, userId);
  }
}

