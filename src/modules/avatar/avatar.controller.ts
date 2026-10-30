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
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import { BastionAuditService, Public } from '@heyatom/bastion-client/nest';
import { auditClientWrite } from '@/common/client-audit';
import { SkipThrottle } from '@nestjs/throttler';
import {
  UploadAvatarDto,
  AvatarResponseDto,
  GetAvatarDto,
  DeleteAvatarResponseDto,
} from './dto';
import { IMAGE_UPLOAD_LIMITS } from '@/modules/storage/storage.service';
import { contentDisposition } from '@/utils/content-disposition';
import { ApiCreatedData, ApiOkData, NoTransform } from '@heyatom/nest-common';

@ApiTags('Avatars')
@ApiSecurity('api-key')
@Controller('avatars')
@UseInterceptors(ClientInterceptor)
export class AvatarController {
  private readonly logger = new Logger(AvatarController.name);

  constructor(
    private avatarService: AvatarService,
    private audit: BastionAuditService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Upload or update creator avatar',
    description:
      'Upload new avatar or update existing one for a creator. Auto-converts to WebP, creates thumbnail, and optimizes.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  @ApiCreatedData(AvatarResponseDto, 'Avatar uploaded successfully')
  @ApiResponse({
    status: 400,
    description: 'No file uploaded, invalid format, or missing externalUserId',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { ...IMAGE_UPLOAD_LIMITS, files: 1 } }),
  )
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
  // Media delivery: one page can embed dozens of these.
  @SkipThrottle()
  @NoTransform()
  @Get(':clientRef/:externalUserId')
  @ApiOperation({
    summary: 'Get creator avatar (public endpoint)',
    description:
      'Retrieve a creator avatar. clientRef is the client domain, or its id when it has none (the url/fullPath returned by the API already carry it). Query parameters: info (return JSON metadata), thumb (return thumbnail), format (webp | jpeg | png, default webp; converted on the fly, combinable with thumb), download (force download), t (timestamp for cache busting)',
  })
  @ApiResponse({ status: 200, description: 'Avatar file or metadata' })
  @ApiResponse({ status: 404, description: 'Client or avatar not found' })
  async getClientAvatar(
    @Param('clientRef') ref: string,
    @Param('externalUserId') externalUserId: string,
    @Query() query: GetAvatarDto,
    @Res() res: Response,
  ) {
    const clientId = await this.avatarService.resolveClientRef(ref);
    return this.sendAvatar(clientId, externalUserId, query, res, {});
  }

  @Public()
  @SkipThrottle()
  @NoTransform()
  @Get(':externalUserId')
  @ApiOperation({
    summary: 'Get creator avatar (deprecated)',
    deprecated: true,
    description:
      'Deprecated: use GET /avatars/{clientRef}/{externalUserId}. An external id is unique only within a client: without an X-API-Key this route serves it only when exactly one client has a creator with that id, and 404s otherwise.',
  })
  @ApiResponse({ status: 200, description: 'Avatar file or metadata' })
  @ApiResponse({ status: 404, description: 'Avatar not found or ambiguous' })
  async getAvatar(
    @Param('externalUserId') externalUserId: string,
    @Query() query: GetAvatarDto,
    @Res() res: Response,
    // Set only when a valid X-API-Key is sent (the route is public).
    @ClientId() clientId: string | undefined,
  ) {
    // Calls still landing here show up as
    // http_request_duration_seconds{route="/avatars/:externalUserId"}.
    return this.sendAvatar(clientId, externalUserId, query, res, {
      Deprecation: 'true',
      // The API key picks the client, hence the creator: keep caches apart.
      Vary: 'X-API-Key',
    });
  }

  private async sendAvatar(
    clientId: string | undefined,
    externalUserId: string,
    query: GetAvatarDto,
    res: Response,
    extraHeaders: Record<string, string>,
  ) {
    this.logger.debug(
      `[getAvatar] Starting - Creator: ${externalUserId}, Info: ${query.info}, Thumb: ${query.thumb}, Format: ${query.format ?? 'webp'}, Download: ${query.download}`,
    );

    try {
      // If info mode, return metadata as JSON
      if (query.info) {
        const avatar = await this.avatarService.getAvatarByExternalId(
          clientId,
          externalUserId,
        );
        const metadata = this.avatarService.getAvatarMetadata(
          avatar,
          externalUserId,
        );
        this.logger.log(
          `[getAvatar] Metadata returned - Creator: ${externalUserId}`,
        );
        res.set(extraHeaders);
        // @NoTransform route (it serves files): envelope the JSON branch by hand
        return res.json({ data: metadata });
      }

      // Otherwise return the file
      const { buffer, mimeType, updatedAt } =
        await this.avatarService.getAvatarFile(
          clientId,
          externalUserId,
          query.thumb,
          query.format,
        );

      // Variant suffix keeps thumb/format variants apart in caches and filenames
      const format = query.format ?? 'webp';
      const variant = `${query.thumb ? '-thumb' : ''}${format === 'webp' ? '' : `-${format}`}`;
      const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400',
        // updatedAt moves on every re-upload (upsert): without it a browser
        // revalidating after max-age would get 304 and keep the old avatar forever.
        ETag: `"avatar-${externalUserId}${variant}-${updatedAt.getTime()}"`,
        ...extraHeaders,
      };

      if (query.download) {
        const filename = `avatar-${externalUserId}${variant}.${format === 'jpeg' ? 'jpg' : format}`;
        headers['Content-Disposition'] = contentDisposition(filename);
        this.logger.debug(`[getAvatar] Download - Creator: ${externalUserId}`);
      } else {
        this.logger.debug(
          `[getAvatar] View - Creator: ${externalUserId}, Thumb: ${query.thumb}`,
        );
      }

      this.logger.debug(
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
  @ApiOkData(DeleteAvatarResponseDto, 'Avatar deleted successfully')
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  async deleteAvatar(
    @ClientId() clientId: string,
    @Param('externalUserId') externalUserId: string,
    // Who deletes, not whose avatar it is: that one is the path.
    @CreatorExternalId() actorId: string | undefined,
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
      auditClientWrite(this.audit, 'fh_avatar.deleted', clientId, actorId, {
        ownerExternalUserId: externalUserId,
      });
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
