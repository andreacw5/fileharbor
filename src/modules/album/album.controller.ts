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
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { AlbumService } from './album.service';
import { CreatorService } from '@/modules/creator/creator.service';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import {
  ClientId,
  CreatorExternalId,
} from '@/modules/client/decorators/client.decorator';
import { BastionAuditService, Public } from '@heyatom/bastion-client/nest';
import { auditClientWrite } from '@/common/client-audit';
import {
  CreateAlbumDto,
  UpdateAlbumDto,
  ListAlbumsDto,
  AlbumResponseDto,
  CreateAlbumTokenDto,
  AlbumTokenResponseDto,
  DeleteAlbumResponseDto,
  AddAlbumItemsDto,
  AddAlbumItemsResponseDto,
  RemoveAlbumItemsDto,
  ListAlbumItemsDto,
  AlbumItemDto,
} from './dto';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  PaginatedResult,
} from '@heyatom/nest-common';
import { AdminRemoveImagesFromAlbumResponseDto } from '@/modules/admin/dto/admin-response.dto';

@ApiTags('Albums')
@ApiSecurity('api-key')
@Controller('albums')
@UseInterceptors(ClientInterceptor)
export class AlbumController {
  private readonly logger = new Logger(AlbumController.name);

  constructor(
    private albumService: AlbumService,
    private creatorService: CreatorService,
    private audit: BastionAuditService,
  ) {}

  /**
   * X-User-Id → internal Creator.id: Album.creatorId is a FK to Creator.id,
   * and ownership compares it. Created on first use only by POST /albums (like
   * image and video uploads); every other write only looks it up, so a wrong
   * X-User-Id on PATCH/DELETE gets 403 without leaving a phantom Creator row.
   */
  private async ownerId(
    clientId: string,
    externalId: string | undefined,
    { create = false } = {},
  ): Promise<string> {
    if (!externalId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    if (create)
      return (await this.creatorService.resolveCreator(clientId, externalId))
        .id;
    const id = await this.albumService.findCreatorId(clientId, externalId);
    if (!id) throw new ForbiddenException('Not the album owner');
    return id;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new album' })
  @ApiCreatedData(AlbumResponseDto)
  async createAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Body() dto: CreateAlbumDto,
  ): Promise<AlbumResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId, { create: true });
    return this.albumService.createAlbum(clientId, ownerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List albums with filtering and pagination' })
  @ApiPaginatedResponse(AlbumResponseDto)
  async listAlbums(
    @ClientId() clientId: string,
    @Query() query: ListAlbumsDto,
  ) {
    return this.albumService.listAlbums(
      {
        clientId,
        creatorId: query.creatorId,
        public: query.public,
        search: query.search,
      },
      query,
    );
  }

  @Public()
  @Get('shared/:token')
  @ApiOperation({ summary: 'Access album via shared token (public)' })
  @ApiOkData(AlbumResponseDto)
  async getAlbumByToken(
    @Param('token') token: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumBySharedToken(token);
  }

  @Get(':albumId')
  @ApiOperation({ summary: 'Get album info by ID' })
  @ApiOkData(AlbumResponseDto)
  async getAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumWithItems(
      albumId,
      clientId,
      await this.albumService.findCreatorId(clientId, creatorId),
    );
  }

  @Patch(':albumId')
  @ApiOperation({ summary: 'Update album metadata' })
  @ApiOkData(AlbumResponseDto)
  async updateAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
    @Body() dto: UpdateAlbumDto,
  ): Promise<AlbumResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.updateAlbum(albumId, clientId, ownerId, dto);
  }

  @Delete(':albumId')
  @ApiOperation({ summary: 'Delete album' })
  @ApiOkData(DeleteAlbumResponseDto)
  async deleteAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    const result = await this.albumService.deleteAlbum(
      albumId,
      clientId,
      ownerId,
    );
    auditClientWrite(this.audit, 'fh_album.deleted', clientId, creatorId, {
      albumId,
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Items (images + videos)
  // ---------------------------------------------------------------------------

  @Post(':albumId/items')
  @ApiOperation({ summary: 'Add images and/or videos to album' })
  @ApiCreatedData(AddAlbumItemsResponseDto)
  async addItems(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
    @Body() dto: AddAlbumItemsDto,
  ): Promise<AddAlbumItemsResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.addItemsToAlbum(albumId, clientId, dto.items, {
      creatorId: ownerId,
    });
  }

  @Delete(':albumId/items')
  @ApiOperation({ summary: 'Remove images and/or videos from album' })
  @ApiOkData(AdminRemoveImagesFromAlbumResponseDto)
  @ApiBody({ type: RemoveAlbumItemsDto })
  async removeItems(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
    @Body() dto: RemoveAlbumItemsDto,
  ) {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.removeItemsFromAlbum(
      albumId,
      clientId,
      dto.items,
      { creatorId: ownerId },
    );
  }

  @Get(':albumId/items')
  @ApiOperation({ summary: 'List album items ordered (images and/or videos)' })
  @ApiPaginatedResponse(AlbumItemDto)
  async listItems(
    @ClientId() clientId: string,
    @Param('albumId') albumId: string,
    @Query() query: ListAlbumItemsDto,
  ): Promise<PaginatedResult<AlbumItemDto>> {
    return this.albumService.listAlbumItems(albumId, clientId, query);
  }

  // ---------------------------------------------------------------------------
  // Token
  // ---------------------------------------------------------------------------

  @Post(':albumId/token')
  @ApiOperation({ summary: 'Generate access token for private album' })
  @ApiCreatedData(AlbumTokenResponseDto)
  async generateAlbumToken(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
    @Body() dto?: CreateAlbumTokenDto,
  ): Promise<AlbumTokenResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.generateAlbumToken(
      albumId,
      clientId,
      ownerId,
      dto?.expiresInDays,
    );
  }

  @Delete(':albumId/token')
  @ApiOperation({ summary: 'Revoke all access tokens for album' })
  @ApiOkData(DeleteAlbumResponseDto)
  async revokeAlbumToken(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.revokeAlbumToken(albumId, clientId, ownerId);
  }

  // ---------------------------------------------------------------------------
  // External ID routes
  // ---------------------------------------------------------------------------

  @Get('external/:externalAlbumId')
  @ApiOperation({ summary: 'Get album by external ID' })
  @ApiOkData(AlbumResponseDto)
  async getAlbumByExternalId(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('externalAlbumId') externalAlbumId: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumWithItemsByExternalId(
      externalAlbumId,
      clientId,
      await this.albumService.findCreatorId(clientId, creatorId),
    );
  }

  @Patch('external/:externalAlbumId')
  @ApiOperation({ summary: 'Update album by external ID' })
  @ApiOkData(AlbumResponseDto)
  async updateAlbumByExternalId(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: UpdateAlbumDto,
  ): Promise<AlbumResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.updateAlbumByExternalId(
      externalAlbumId,
      clientId,
      ownerId,
      dto,
    );
  }

  @Post('external/:externalAlbumId/items')
  @ApiOperation({ summary: 'Add items to album by external ID' })
  @ApiCreatedData(AddAlbumItemsResponseDto)
  async addItemsToAlbumByExternalId(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: AddAlbumItemsDto,
  ): Promise<AddAlbumItemsResponseDto> {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.addItemsToAlbumByExternalId(
      externalAlbumId,
      clientId,
      dto.items,
      { creatorId: ownerId },
    );
  }

  @Delete('external/:externalAlbumId/items')
  @ApiOperation({ summary: 'Remove items from album by external ID' })
  @ApiOkData(AdminRemoveImagesFromAlbumResponseDto)
  @ApiBody({ type: RemoveAlbumItemsDto })
  async removeItemsFromAlbumByExternalId(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: RemoveAlbumItemsDto,
  ) {
    const ownerId = await this.ownerId(clientId, creatorId);
    return this.albumService.removeItemsFromAlbumByExternalId(
      externalAlbumId,
      clientId,
      dto.items,
      { creatorId: ownerId },
    );
  }
}
