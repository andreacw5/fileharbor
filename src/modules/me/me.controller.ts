import {
  Controller,
  Get,
  Put,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { BastionSelfServiceGuard } from '@/modules/bastion/guards/bastion-self-service.guard';
import { BastionUserPayload } from '@/modules/bastion/bastion.types';
import { CurrentUser } from '@/modules/bastion/decorators/current-user.decorator';
import { MeService } from './me.service';
import {
  AvatarResponseDto,
  DeleteAvatarResponseDto,
} from '@/modules/avatar/dto';
import { MeAvatarStatusDto } from './dto';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_AVATAR_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/**
 * Self-service endpoints for the currently signed-in Bastion user — no console
 * permission required (see BastionSelfServiceGuard). externalUserId is always the
 * verified token `sub`, never taken from body/headers.
 */
@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(BastionSelfServiceGuard)
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(private readonly meService: MeService) {}

  @Get('avatar')
  @ApiOperation({ summary: "Get the current user's avatar status" })
  @ApiResponse({ status: 200, type: MeAvatarStatusDto })
  async getAvatar(
    @CurrentUser() user: BastionUserPayload,
  ): Promise<MeAvatarStatusDto> {
    return this.meService.getAvatar(user.tenantSlug, user.sub);
  }

  @Put('avatar')
  @ApiOperation({ summary: "Upload or replace the current user's avatar" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 200, type: AvatarResponseDto })
  @ApiResponse({
    status: 400,
    description: 'No file uploaded, or an unsupported image format',
  })
  @ApiResponse({ status: 413, description: 'File exceeds the 5 MB limit' })
  @ApiResponse({
    status: 422,
    description: 'No FileHarbor client mapped to this tenant',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }),
  )
  async uploadAvatar(
    @CurrentUser() user: BastionUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    if (!file) {
      this.logger.warn(
        `[uploadAvatar] No file provided - tenant: ${user.tenantSlug}, sub: ${user.sub}`,
      );
      throw new BadRequestException('No file uploaded');
    }
    if (!ALLOWED_AVATAR_MIME_TYPES.includes(file.mimetype)) {
      this.logger.warn(
        `[uploadAvatar] Unsupported MIME type - tenant: ${user.tenantSlug}, sub: ${user.sub}, type: ${file.mimetype}`,
      );
      throw new BadRequestException(
        'Only PNG, JPEG, WebP, and GIF images are allowed',
      );
    }

    this.logger.log(
      `[uploadAvatar] tenant: ${user.tenantSlug}, sub: ${user.sub}, size: ${file.size} bytes`,
    );
    return this.meService.uploadAvatar(user.tenantSlug, user.sub, file);
  }

  @Delete('avatar')
  @ApiOperation({ summary: "Delete the current user's avatar" })
  @ApiResponse({ status: 200, type: DeleteAvatarResponseDto })
  @ApiResponse({ status: 404, description: 'No avatar to delete' })
  @ApiResponse({
    status: 422,
    description: 'No FileHarbor client mapped to this tenant',
  })
  async deleteAvatar(
    @CurrentUser() user: BastionUserPayload,
  ): Promise<DeleteAvatarResponseDto> {
    this.logger.log(
      `[deleteAvatar] tenant: ${user.tenantSlug}, sub: ${user.sub}`,
    );
    return this.meService.deleteAvatar(user.tenantSlug, user.sub);
  }
}
