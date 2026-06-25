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
  ApiBody,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AlbumResourceType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUpdateAlbumDto } from '../dto/admin-update-album.dto';
import { AdminCreateAlbumDto } from '../dto/admin-create-album.dto';
import { AdminDeleteResponseDto, AdminAlbumResponseDto } from '../dto/admin-response.dto';
import { AddAlbumItemsDto, AddAlbumItemsResponseDto, RemoveAlbumItemsDto, ListAlbumItemsDto, AlbumItemListResponseDto } from '@/modules/album/dto';
import { AlbumService } from '@/modules/album/album.service';
import { ClientService } from '@/modules/client/client.service';
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
  @ApiOperation({ summary: 'Create an album on behalf of a client' })
  @ApiResponse({ status: 201, type: AdminAlbumResponseDto })
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

    const enriched = await this.albumService.findAdminAlbumById(album.id);
    if (!enriched) throw new NotFoundException('Album not found');

    this.logger.log(`[Admin] Album created: ${album.id} for client: ${dto.clientId}`);
    return plainToInstance(
      AdminAlbumResponseDto,
      { ...enriched, totalItems: enriched._count.albumItems, activeTokens: enriched._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List albums (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'search', required: false })
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
      data: albums.map((a) => ({
        ...a,
        totalItems: a._count.albumItems,
        activeTokens: a._count.albumTokens,
        coverImageUrl: a.coverImageId ? this.buildImageFullPath(a.coverImageId) : undefined,
      })),
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
      {
        ...album,
        totalItems: album._count.albumItems,
        activeTokens: album._count.albumTokens,
        coverImageUrl: album.coverImageId ? this.buildImageFullPath(album.coverImageId) : undefined,
      },
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
        totalItems: updated._count.albumItems,
        activeTokens: updated._count.albumTokens,
        coverImageUrl: updated.coverImageId ? this.buildImageFullPath(updated.coverImageId) : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Items (admin — force mode, bypass ownership)
  // ---------------------------------------------------------------------------

  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add images and/or videos to album (admin, bypasses ownership)' })
  @ApiResponse({ status: 200, type: AddAlbumItemsResponseDto })
  async addItems(
    @Param('id') id: string,
    @Body() dto: AddAlbumItemsDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AddAlbumItemsResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.addItemsToAlbum(id, album.clientId, dto.items, { force: true });
    this.logger.log(`[Admin] Added ${result.count} items to album: ${id}`);
    return result;
  }

  @Delete(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove images and/or videos from album (admin)' })
  @ApiBody({ type: RemoveAlbumItemsDto })
  async removeItems(
    @Param('id') id: string,
    @Body() dto: RemoveAlbumItemsDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ) {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.removeItemsFromAlbum(id, album.clientId, dto.items, { force: true });
    this.logger.log(`[Admin] Removed ${result.removed} items from album: ${id}`);
    return result;
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'List album items ordered (admin)' })
  @ApiQuery({ name: 'resourceType', required: false, enum: AlbumResourceType })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AlbumItemListResponseDto })
  async listItems(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
    @Query() query: ListAlbumItemsDto,
  ): Promise<AlbumItemListResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    return this.albumService.listAlbumItems(album.id, album.clientId, {
      resourceType: query.resourceType,
      page: query.page ?? 1,
      perPage: query.perPage ?? 20,
    });
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

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

  private buildImageFullPath(imageId: string): string {
    const apiPrefix = this.config.get('apiPrefix') || 'v2';
    const baseUrl = this.config.get('baseUrl') || 'http://localhost:3000';
    return `${baseUrl}/${apiPrefix}/images/${imageId}`;
  }
}
