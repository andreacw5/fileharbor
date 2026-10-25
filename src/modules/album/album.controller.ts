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
import { ApiTags, ApiOperation, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { AlbumService } from './album.service';
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
    private audit: BastionAuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new album' })
  @ApiCreatedData(AlbumResponseDto)
  async createAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Body() dto: CreateAlbumDto,
  ): Promise<AlbumResponseDto> {
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.createAlbum(clientId, creatorId, dto);
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
    return this.albumService.getAlbumWithItems(albumId, clientId, creatorId);
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.updateAlbum(albumId, clientId, creatorId, dto);
  }

  @Delete(':albumId')
  @ApiOperation({ summary: 'Delete album' })
  @ApiOkData(DeleteAlbumResponseDto)
  async deleteAlbum(
    @ClientId() clientId: string,
    @CreatorExternalId() creatorId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    const result = await this.albumService.deleteAlbum(
      albumId,
      clientId,
      creatorId,
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.addItemsToAlbum(albumId, clientId, dto.items, {
      creatorId,
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.removeItemsFromAlbum(
      albumId,
      clientId,
      dto.items,
      { creatorId },
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.generateAlbumToken(
      albumId,
      clientId,
      creatorId,
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.revokeAlbumToken(albumId, clientId, creatorId);
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
      creatorId,
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.updateAlbumByExternalId(
      externalAlbumId,
      clientId,
      creatorId,
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.addItemsToAlbumByExternalId(
      externalAlbumId,
      clientId,
      dto.items,
      { creatorId },
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
    if (!creatorId)
      throw new BadRequestException(
        'Creator ID is required (X-User-Id header)',
      );
    return this.albumService.removeItemsFromAlbumByExternalId(
      externalAlbumId,
      clientId,
      dto.items,
      { creatorId },
    );
  }
}
