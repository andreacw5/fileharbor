import { SkipThrottle } from '@nestjs/throttler';
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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { AdminUpdateAlbumDto } from '../dto/admin-update-album.dto';
import { AdminCreateAlbumDto } from '../dto/admin-create-album.dto';
import {
  AdminDeleteResponseDto,
  AdminAlbumResponseDto,
  AdminAlbumListItemDto,
  AdminRemoveImagesFromAlbumResponseDto,
} from '../dto/admin-response.dto';
import {
  AddAlbumItemsDto,
  AddAlbumItemsResponseDto,
  RemoveAlbumItemsDto,
  ListAlbumItemsDto,
  AlbumItemDto,
} from '@/modules/album/dto';
import { AlbumService } from '@/modules/album/album.service';
import { ClientService } from '@/modules/client/client.service';
import { RouteHelperService } from '@/utils/route.utils';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  paginate,
  PaginatedResult,
} from '@heyatom/nest-common';
import { AdminAlbumListQuery } from '../dto/admin-list-query.dto';

@ApiTags('Admin - Albums')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/albums')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-library.manage')
export class AlbumsAdminController {
  private readonly logger = new Logger(AlbumsAdminController.name);

  constructor(
    private readonly albumService: AlbumService,
    private readonly clientService: ClientService,
    private readonly route: RouteHelperService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an album on behalf of a client' })
  @ApiCreatedData(AdminAlbumResponseDto)
  @Audit('fh_album.created', {
    metadata: (r: AdminAlbumResponseDto) => ({
      albumId: r.id,
      name: r.name,
      clientId: r.clientId,
      isPublic: r.isPublic,
    }),
  })
  async createAlbum(
    @Body() dto: AdminCreateAlbumDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    assertClientAccess(adminUser, dto.clientId);

    const externalId = dto.externalId || 'system';
    const creator = await this.clientService.getOrCreateUser(
      dto.clientId,
      externalId,
    );

    const album = await this.albumService.createAlbum(
      dto.clientId,
      creator.id,
      {
        name: dto.name,
        description: dto.description,
        isPublic: dto.isPublic,
        externalAlbumId: dto.externalAlbumId,
      },
    );

    const enriched = await this.albumService.findAdminAlbumById(album.id);
    if (!enriched) throw new NotFoundException('Album not found');

    this.logger.log(
      `[Admin] Album created: ${album.id} for client: ${dto.clientId}`,
    );
    return plainToInstance(
      AdminAlbumResponseDto,
      {
        ...enriched,
        totalItems: enriched._count.albumItems,
        activeTokens: enriched._count.albumTokens,
      },
      { excludeExtraneousValues: true },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List albums (scoped to accessible clients)' })
  @ApiPaginatedResponse(AdminAlbumListItemDto)
  async listAlbums(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminAlbumListQuery,
  ) {
    const { clientId, creatorId, search, public: publicFilter } = query;
    const where: any = buildClientWhere(adminUser, clientId);
    if (creatorId) where.creator = { externalId: creatorId };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (publicFilter !== undefined) {
      where.isPublic =
        publicFilter === 'true'
          ? true
          : publicFilter === 'false'
            ? false
            : undefined;
    }

    const { albums, total } = await this.albumService.findAdminAlbums(where, {
      skip: query.skip,
      take: query.limit,
    });

    return paginate(
      albums.map((a) => ({
        ...a,
        totalItems: a._count.albumItems,
        activeTokens: a._count.albumTokens,
        coverImageUrl: a.coverImageId
          ? this.buildImageFullPath(a.coverImageId)
          : undefined,
      })),
      total,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get album details' })
  @ApiOkData(AdminAlbumResponseDto)
  async getAlbum(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
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
        coverImageUrl: album.coverImageId
          ? this.buildImageFullPath(album.coverImageId)
          : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update album name, description or visibility' })
  @ApiOkData(AdminAlbumResponseDto)
  @Audit('fh_album.updated', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      albumId: req.params.id,
      fields: Object.keys((req.body ?? {}) as Record<string, unknown>),
    }),
  })
  async updateAlbum(
    @Param('id') id: string,
    @Body() dto: AdminUpdateAlbumDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    const existing = await this.albumService.getAlbumByIdUnscoped(id);
    if (!existing) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if ('externalAlbumId' in dto)
      data.externalAlbumId = dto.externalAlbumId ?? null;
    if ('coverImageId' in dto) data.coverImageId = dto.coverImageId ?? null;

    const updated = await this.albumService.adminUpdateAlbum(id, data);
    this.logger.log(`[Admin] Album updated: ${id}`);

    return plainToInstance(
      AdminAlbumResponseDto,
      {
        ...updated,
        totalItems: updated._count.albumItems,
        activeTokens: updated._count.albumTokens,
        coverImageUrl: updated.coverImageId
          ? this.buildImageFullPath(updated.coverImageId)
          : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }

  // ---------------------------------------------------------------------------
  // Items (admin — force mode, bypass ownership)
  // ---------------------------------------------------------------------------

  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add images and/or videos to album (admin, bypasses ownership)',
  })
  @ApiOkData(AddAlbumItemsResponseDto)
  @Audit('fh_album.items_added', {
    metadata: (r: AddAlbumItemsResponseDto, req: AuditRequest) => ({
      albumId: req.params.id,
      count: r?.count,
    }),
  })
  async addItems(
    @Param('id') id: string,
    @Body() dto: AddAlbumItemsDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AddAlbumItemsResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.addItemsToAlbum(
      id,
      album.clientId,
      dto.items,
      { force: true },
    );
    this.logger.log(`[Admin] Added ${result.count} items to album: ${id}`);
    return result;
  }

  @Delete(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove images and/or videos from album (admin)' })
  @ApiBody({ type: RemoveAlbumItemsDto })
  @ApiOkData(AdminRemoveImagesFromAlbumResponseDto)
  @Audit('fh_album.items_removed', {
    metadata: (r: { removed?: number }, req: AuditRequest) => ({
      albumId: req.params.id,
      removed: r?.removed,
    }),
  })
  async removeItems(
    @Param('id') id: string,
    @Body() dto: RemoveAlbumItemsDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ) {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    const result = await this.albumService.removeItemsFromAlbum(
      id,
      album.clientId,
      dto.items,
      { force: true },
    );
    this.logger.log(
      `[Admin] Removed ${result.removed} items from album: ${id}`,
    );
    return result;
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'List album items ordered (admin)' })
  @ApiPaginatedResponse(AlbumItemDto)
  async listItems(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: ListAlbumItemsDto,
  ): Promise<PaginatedResult<AlbumItemDto>> {
    const album = await this.albumService.getAlbumByIdUnscoped(id);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(adminUser, album.clientId);

    return this.albumService.listAlbumItems(album.id, album.clientId, query);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete an album (admin)' })
  @ApiOkData(AdminDeleteResponseDto)
  @Audit('fh_album.deleted', {
    metadata: (_r: unknown, req: AuditRequest) => ({ albumId: req.params.id }),
  })
  async deleteAlbum(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
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
    return this.route.fullUrl('images', imageId);
  }
}
