import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { AlbumService } from './album.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { ClientId, UserId } from '@/modules/client/decorators/client.decorator';
import { Public } from '@/modules/client/decorators/public.decorator';
import {
  CreateAlbumDto,
  UpdateAlbumDto,
  ListAlbumsDto,
  ListAlbumsResponseDto,
  AlbumResponseDto,
  ManageAlbumImagesDto,
  AlbumImagesResponseDto,
  CreateAlbumTokenDto,
  AlbumTokenResponseDto,
  DeleteAlbumResponseDto,
} from './dto';

@ApiTags('Albums')
@ApiSecurity('api-key')
@Controller('albums')
@UseInterceptors(ClientInterceptor)
export class AlbumController {
  private readonly logger = new Logger(AlbumController.name);

  constructor(private albumService: AlbumService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new album' })
  @ApiResponse({ status: 201, type: AlbumResponseDto })
  async createAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Body() dto: CreateAlbumDto,
  ): Promise<AlbumResponseDto> {
    if (!userId) {
      this.logger.warn(`[createAlbum] Missing User ID - Client: ${clientId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[createAlbum] Starting - Client: ${clientId}, User: ${userId}, Name: ${dto.name}, Public: ${dto.isPublic}`
    );

    try {
      const result = await this.albumService.createAlbum(clientId, userId, dto);
      this.logger.log(`[createAlbum] Success - Album ID: ${result.id}, Client: ${clientId}, User: ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`[createAlbum] Failed - Client: ${clientId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'List albums with filtering and pagination' })
  @ApiResponse({ status: 200, type: ListAlbumsResponseDto })
  async listAlbums(
    @ClientId() clientId: string,
    @Query() query: ListAlbumsDto,
  ): Promise<ListAlbumsResponseDto> {
    this.logger.debug(
      `[listAlbums] Client: ${clientId}, User: ${query.userId || 'all'}, Public: ${query.public}, Page: ${query.page || 1}`
    );

    const result = await this.albumService.listAlbums({
      clientId,
      userId: query.userId,
      public: query.public,
      search: query.search,
      page: query.page,
      perPage: query.perPage,
    });

    this.logger.log(
      `[listAlbums] Success - Client: ${clientId}, Total: ${result.pagination.total}, Returned: ${result.data.length}`
    );

    return result;
  }

  @Public()
  @Get('shared/:token')
  @ApiOperation({ summary: 'Access album via shared token (public)' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbumByToken(@Param('token') token: string): Promise<AlbumResponseDto> {
    this.logger.debug(`[getAlbumByToken] Starting - Token: ${token}`);

    try {
      const result = await this.albumService.getAlbumBySharedToken(token);
      this.logger.log(`[getAlbumByToken] Success - Album ID: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`[getAlbumByToken] Failed - Error: ${error.message}`);
      throw error;
    }
  }

  @Get(':albumId')
  @ApiOperation({ summary: 'Get album with images by ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<AlbumResponseDto> {
    this.logger.debug(`[getAlbum] Starting - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`);

    try {
      const result = await this.albumService.getAlbumWithImages(albumId, clientId, userId);
      this.logger.log(`[getAlbum] Success - Album ID: ${albumId}, Images: ${result.imageCount}`);
      return result;
    } catch (error) {
      this.logger.error(`[getAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Patch(':albumId')
  @ApiOperation({ summary: 'Update album metadata' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async updateAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto: UpdateAlbumDto,
  ): Promise<AlbumResponseDto> {
    if (!userId) {
      this.logger.warn(`[updateAlbum] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(`[updateAlbum] Starting - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`);

    try {
      const result = await this.albumService.updateAlbum(albumId, clientId, userId, dto);
      this.logger.log(`[updateAlbum] Success - Album ID: ${albumId}`);
      return result;
    } catch (error) {
      this.logger.error(`[updateAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Delete(':albumId')
  @ApiOperation({ summary: 'Delete album (images are preserved)' })
  @ApiResponse({ status: 200, type: DeleteAlbumResponseDto })
  async deleteAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    if (!userId) {
      this.logger.warn(`[deleteAlbum] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(`[deleteAlbum] Starting - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`);

    try {
      const result = await this.albumService.deleteAlbum(albumId, clientId, userId);
      this.logger.log(`[deleteAlbum] Success - Album ID: ${albumId}`);
      return result;
    } catch (error) {
      this.logger.error(`[deleteAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Post(':albumId/images')
  @ApiOperation({ summary: 'Add images to album' })
  @ApiResponse({ status: 201, type: AlbumImagesResponseDto })
  async addImagesToAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto: ManageAlbumImagesDto,
  ): Promise<AlbumImagesResponseDto> {
    if (!userId) {
      this.logger.warn(`[addImagesToAlbum] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[addImagesToAlbum] Starting - Album ID: ${albumId}, Client: ${clientId}, Images: ${dto.imageIds.length}`
    );

    try {
      await this.albumService.addImagesToAlbum(albumId, clientId, userId, dto.imageIds);
      this.logger.log(`[addImagesToAlbum] Success - Album ID: ${albumId}, Added: ${dto.imageIds.length}`);
      return {
        success: true,
        message: `Added ${dto.imageIds.length} image(s) to album`,
        added: dto.imageIds.length,
      };
    } catch (error) {
      this.logger.error(`[addImagesToAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Delete(':albumId/images')
  @ApiOperation({ summary: 'Remove images from album' })
  @ApiResponse({ status: 200, type: AlbumImagesResponseDto })
  async removeImagesFromAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto: ManageAlbumImagesDto,
  ): Promise<AlbumImagesResponseDto> {
    if (!userId) {
      this.logger.warn(`[removeImagesFromAlbum] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[removeImagesFromAlbum] Starting - Album ID: ${albumId}, Client: ${clientId}, Images: ${dto.imageIds.length}`
    );

    try {
      await this.albumService.removeImagesFromAlbum(albumId, clientId, userId, dto.imageIds);
      this.logger.log(`[removeImagesFromAlbum] Success - Album ID: ${albumId}, Removed: ${dto.imageIds.length}`);
      return {
        success: true,
        message: `Removed ${dto.imageIds.length} image(s) from album`,
        removed: dto.imageIds.length,
      };
    } catch (error) {
      this.logger.error(`[removeImagesFromAlbum] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Post(':albumId/token')
  @ApiOperation({ summary: 'Generate access token for private album' })
  @ApiResponse({ status: 201, type: AlbumTokenResponseDto })
  async generateAlbumToken(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto?: CreateAlbumTokenDto,
  ): Promise<AlbumTokenResponseDto> {
    if (!userId) {
      this.logger.warn(`[generateAlbumToken] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[generateAlbumToken] Starting - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`
    );

    try {
      const result = await this.albumService.generateAlbumToken(
        albumId,
        clientId,
        userId,
        dto?.expiresInDays
      );
      this.logger.log(`[generateAlbumToken] Success - Album ID: ${albumId}, Token: ${result.token}`);
      return result;
    } catch (error) {
      this.logger.error(`[generateAlbumToken] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  @Delete(':albumId/token')
  @ApiOperation({ summary: 'Revoke all access tokens for album' })
  @ApiResponse({ status: 200, type: DeleteAlbumResponseDto })
  async revokeAlbumToken(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    if (!userId) {
      this.logger.warn(`[revokeAlbumToken] Missing User ID - Client: ${clientId}, Album: ${albumId}`);
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(`[revokeAlbumToken] Starting - Album ID: ${albumId}, Client: ${clientId}, User: ${userId}`);

    try {
      const result = await this.albumService.revokeAlbumToken(albumId, clientId, userId);
      this.logger.log(`[revokeAlbumToken] Success - Album ID: ${albumId}`);
      return result;
    } catch (error) {
      this.logger.error(`[revokeAlbumToken] Failed - Album ID: ${albumId}, Error: ${error.message}`);
      throw error;
    }
  }

  // ==================== External Album ID Routes ====================

  @Get('external/:externalAlbumId')
  @ApiOperation({ summary: 'Get album with images by external ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
  ): Promise<AlbumResponseDto> {
    this.logger.debug(
      `[getAlbumByExternalId] Starting - External ID: ${externalAlbumId}, Client: ${clientId}, User: ${userId}`
    );

    try {
      const result = await this.albumService.getAlbumWithImagesByExternalId(
        externalAlbumId,
        clientId,
        userId
      );
      this.logger.log(`[getAlbumByExternalId] Success - External ID: ${externalAlbumId}, Images: ${result.imageCount}`);
      return result;
    } catch (error) {
      this.logger.error(
        `[getAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  @Patch('external/:externalAlbumId')
  @ApiOperation({ summary: 'Update album by external ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async updateAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: UpdateAlbumDto,
  ): Promise<AlbumResponseDto> {
    if (!userId) {
      this.logger.warn(
        `[updateAlbumByExternalId] Missing User ID - Client: ${clientId}, External ID: ${externalAlbumId}`
      );
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[updateAlbumByExternalId] Starting - External ID: ${externalAlbumId}, Client: ${clientId}, User: ${userId}`
    );

    try {
      const result = await this.albumService.updateAlbumByExternalId(
        externalAlbumId,
        clientId,
        userId,
        dto
      );
      this.logger.log(`[updateAlbumByExternalId] Success - External ID: ${externalAlbumId}`);
      return result;
    } catch (error) {
      this.logger.error(
        `[updateAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  @Post('external/:externalAlbumId/images')
  @ApiOperation({ summary: 'Add images to album by external ID' })
  @ApiResponse({ status: 201, type: AlbumImagesResponseDto })
  async addImagesToAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: ManageAlbumImagesDto,
  ): Promise<AlbumImagesResponseDto> {
    if (!userId) {
      this.logger.warn(
        `[addImagesToAlbumByExternalId] Missing User ID - Client: ${clientId}, External ID: ${externalAlbumId}`
      );
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[addImagesToAlbumByExternalId] Starting - External ID: ${externalAlbumId}, Client: ${clientId}, Images: ${dto.imageIds.length}`
    );

    try {
      const result = await this.albumService.addImagesToAlbumByExternalId(
        externalAlbumId,
        clientId,
        userId,
        dto.imageIds
      );
      this.logger.log(
        `[addImagesToAlbumByExternalId] Success - External ID: ${externalAlbumId}, Added: ${dto.imageIds.length}`
      );
      return {
        success: true,
        message: `Added ${dto.imageIds.length} image(s) to album`,
        added: result.images.length,
      };
    } catch (error) {
      this.logger.error(
        `[addImagesToAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }

  @Delete('external/:externalAlbumId/images')
  @ApiOperation({ summary: 'Remove images from album by external ID' })
  @ApiResponse({ status: 200, type: AlbumImagesResponseDto })
  async removeImagesFromAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: ManageAlbumImagesDto,
  ): Promise<AlbumImagesResponseDto> {
    if (!userId) {
      this.logger.warn(
        `[removeImagesFromAlbumByExternalId] Missing User ID - Client: ${clientId}, External ID: ${externalAlbumId}`
      );
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    this.logger.debug(
      `[removeImagesFromAlbumByExternalId] Starting - External ID: ${externalAlbumId}, Client: ${clientId}, Images: ${dto.imageIds.length}`
    );

    try {
      const result = await this.albumService.removeImagesFromAlbumByExternalId(
        externalAlbumId,
        clientId,
        userId,
        dto.imageIds
      );
      this.logger.log(
        `[removeImagesFromAlbumByExternalId] Success - External ID: ${externalAlbumId}, Removed: ${result.removed}`
      );
      return {
        success: true,
        message: `Removed ${result.removed} image(s) from album`,
        removed: result.removed,
      };
    } catch (error) {
      this.logger.error(
        `[removeImagesFromAlbumByExternalId] Failed - External ID: ${externalAlbumId}, Error: ${error.message}`
      );
      throw error;
    }
  }
}

