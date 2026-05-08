import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUpdateAlbumDto } from '../dto/admin-update-album.dto';
import { AdminCreateAlbumDto } from '../dto/admin-create-album.dto';
import { AdminAddImagesToAlbumDto } from '../dto/admin-add-images-to-album.dto';
import { AdminRemoveImagesFromAlbumDto } from '../dto/admin-remove-images-from-album.dto';
import {
  AdminDeleteResponseDto,
  AdminAlbumResponseDto,
  AdminAddImagesToAlbumResponseDto,
  AdminRemoveImagesFromAlbumResponseDto,
} from '../dto/admin-response.dto';
import { AlbumService } from '@/modules/album/album.service';
import { ClientService } from '@/modules/client/client.service';
import { plainToInstance } from 'class-transformer';
import { assertClientAccess, buildClientWhere } from '../helpers/admin-access.helper';

@ApiTags('Admin - Albums')
@Controller('admin/albums')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class AlbumsAdminController {
  private readonly logger = new Logger(AlbumsAdminController.name);

  constructor(
    private readonly albumService: AlbumService,
    private readonly clientService: ClientService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an album on behalf of a client',
    description: 'Admin-only album creation. Specify the target clientId in the body. The album is attributed to the given externalUserId (defaults to "system").',
  })
  @ApiResponse({ status: 201, description: 'Album created successfully', type: AdminAlbumResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Admin has no access to the given client' })
  async createAlbum(
    @Body() dto: AdminCreateAlbumDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    assertClientAccess(adminUser, dto.clientId);

    const externalUserId = dto.externalUserId || 'system';
    const user = await this.clientService.getOrCreateUser(dto.clientId, externalUserId);

    const album = await this.albumService.createAlbum(dto.clientId, user.id, {
      name: dto.name,
      description: dto.description,
      isPublic: dto.isPublic,
      externalAlbumId: dto.externalAlbumId,
    });

    this.logger.log(`[Admin] Album created: ${album.id} for client: ${dto.clientId}`);

    // Re-fetch with counts for consistent response shape
    const enriched = await this.albumService.findAdminAlbumById(album.id);
    if (!enriched) throw new NotFoundException('Album not found');

    return plainToInstance(
      AdminAlbumResponseDto,
      { ...enriched, totalImages: enriched._count.albumImages, activeTokens: enriched._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List albums (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Search by album name' })
  @ApiQuery({ name: 'public', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listAlbums(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('public') publicFilter?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = Number(page) || 1;
    const take = Math.min(Number(perPage) || 20, 100);
    const skip = (pageNum - 1) * take;

    const where: any = buildClientWhere(adminUser, clientId);
    if (userId) where.user = { externalUserId: userId };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (publicFilter !== undefined) {
      where.isPublic = publicFilter === 'true' ? true : publicFilter === 'false' ? false : undefined;
    }

    const { albums, total } = await this.albumService.findAdminAlbums(where, { skip, take });

    return {
      data: albums.map((a) => ({ ...a, totalImages: a._count.albumImages, activeTokens: a._count.albumTokens })),
      pagination: { page: pageNum, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get album details' })
  @ApiResponse({ status: 200, type: AdminAlbumResponseDto })
  async getAlbum(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    const album = await this.albumService.findAdminAlbumById(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    return plainToInstance(
      AdminAlbumResponseDto,
      { ...album, totalImages: album._count.albumImages, activeTokens: album._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update album name, description or visibility' })
  @ApiResponse({ status: 200, type: AdminAlbumResponseDto })
  async updateAlbum(
    @Param('id') id: string,
    @Body() dto: AdminUpdateAlbumDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    const existing = await this.albumService.getAlbumByIdUnscoped(id);
    if (!existing) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if ('externalAlbumId' in dto) data.externalAlbumId = dto.externalAlbumId ?? null;
    if ('coverImageId' in dto) data.coverImageId = dto.coverImageId ?? null;

    const updated = await this.albumService.adminUpdateAlbum(id, data);
    this.logger.log(`[Admin] Album updated: ${id}`);

    return plainToInstance(
      AdminAlbumResponseDto,
      {
        ...updated,
        totalImages: updated._count.albumImages,
        activeTokens: updated._count.albumTokens,
        coverImageUrl: updated.coverImageId ? this.buildImageFullPath(updated.coverImageId) : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }

  @Post(':id/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add images to an album (admin)',
    description: 'Admin-only. Bypasses ownership check — verifies only that both album and images belong to the same client.',
  })
  @ApiResponse({ status: 200, description: 'Images added successfully', type: AdminAddImagesToAlbumResponseDto })
  @ApiResponse({ status: 404, description: 'Album or some images not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async addImagesToAlbum(
    @Param('id') id: string,
    @Body() dto: AdminAddImagesToAlbumDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAddImagesToAlbumResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');

    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.forceAddImagesToAlbum(id, album.clientId, dto.imageIds);

    this.logger.log(`[Admin] Added ${result.images.length} images to album: ${id}`);

    return plainToInstance(
      AdminAddImagesToAlbumResponseDto,
      { albumId: result.albumId, images: result.images, count: result.images.length },
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove images from an album (admin)',
    description: 'Admin-only. Bypasses ownership check — verifies only that the album belongs to the client.',
  })
  @ApiResponse({ status: 200, description: 'Images removed successfully', type: AdminRemoveImagesFromAlbumResponseDto })
  @ApiResponse({ status: 404, description: 'Album not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async removeImagesFromAlbum(
    @Param('id') id: string,
    @Body() dto: AdminRemoveImagesFromAlbumDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminRemoveImagesFromAlbumResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');

    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.forceRemoveImagesFromAlbum(id, album.clientId, dto.imageIds);

    this.logger.log(`[Admin] Removed ${result.removed} images from album: ${id}`);

    return plainToInstance(
      AdminRemoveImagesFromAlbumResponseDto,
      result,
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete an album (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  async deleteAlbum(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    await this.albumService.forceDeleteAlbum(id, album.clientId);

    this.logger.log(`[Admin] Album deleted: ${id}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Album deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Build full path URL for image
   */
  private buildImageFullPath(imageId: string): string {
    const apiPrefix = this.config.get('apiPrefix') || 'v2';
    const baseUrl = this.config.get('baseUrl') || 'http://localhost:3000';
    return `${baseUrl}/${apiPrefix}/images/${imageId}`;
  }
}

