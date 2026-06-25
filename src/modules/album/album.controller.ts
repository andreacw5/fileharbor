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
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
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
  CreateAlbumTokenDto,
  AlbumTokenResponseDto,
  DeleteAlbumResponseDto,
  AddAlbumItemsDto,
  AddAlbumItemsResponseDto,
  RemoveAlbumItemsDto,
  ListAlbumItemsDto,
  AlbumItemListResponseDto,
} from './dto';
import { AlbumResourceType } from '@prisma/client';

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
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.createAlbum(clientId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List albums with filtering and pagination' })
  @ApiResponse({ status: 200, type: ListAlbumsResponseDto })
  async listAlbums(
    @ClientId() clientId: string,
    @Query() query: ListAlbumsDto,
  ): Promise<ListAlbumsResponseDto> {
    return this.albumService.listAlbums({
      clientId,
      userId: query.userId,
      public: query.public,
      search: query.search,
      page: query.page,
      perPage: query.perPage,
    });
  }

  @Public()
  @Get('shared/:token')
  @ApiOperation({ summary: 'Access album via shared token (public)' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbumByToken(@Param('token') token: string): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumBySharedToken(token);
  }

  @Get(':albumId')
  @ApiOperation({ summary: 'Get album info by ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumWithItems(albumId, clientId, userId);
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
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.updateAlbum(albumId, clientId, userId, dto);
  }

  @Delete(':albumId')
  @ApiOperation({ summary: 'Delete album' })
  @ApiResponse({ status: 200, type: DeleteAlbumResponseDto })
  async deleteAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.deleteAlbum(albumId, clientId, userId);
  }

  // ---------------------------------------------------------------------------
  // Items (images + videos)
  // ---------------------------------------------------------------------------

  @Post(':albumId/items')
  @ApiOperation({ summary: 'Add images and/or videos to album' })
  @ApiResponse({ status: 201, type: AddAlbumItemsResponseDto })
  async addItems(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto: AddAlbumItemsDto,
  ): Promise<AddAlbumItemsResponseDto> {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.addItemsToAlbum(albumId, clientId, dto.items, { userId });
  }

  @Delete(':albumId/items')
  @ApiOperation({ summary: 'Remove images and/or videos from album' })
  @ApiBody({ type: RemoveAlbumItemsDto })
  async removeItems(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto: RemoveAlbumItemsDto,
  ) {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.removeItemsFromAlbum(albumId, clientId, dto.items, { userId });
  }

  @Get(':albumId/items')
  @ApiOperation({ summary: 'List album items ordered (images and/or videos)' })
  @ApiQuery({ name: 'resourceType', required: false, enum: AlbumResourceType })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AlbumItemListResponseDto })
  async listItems(
    @ClientId() clientId: string,
    @Param('albumId') albumId: string,
    @Query() query: ListAlbumItemsDto,
  ): Promise<AlbumItemListResponseDto> {
    return this.albumService.listAlbumItems(albumId, clientId, {
      resourceType: query.resourceType,
      page: query.page ?? 1,
      perPage: query.perPage ?? 20,
    });
  }

  // ---------------------------------------------------------------------------
  // Token
  // ---------------------------------------------------------------------------

  @Post(':albumId/token')
  @ApiOperation({ summary: 'Generate access token for private album' })
  @ApiResponse({ status: 201, type: AlbumTokenResponseDto })
  async generateAlbumToken(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
    @Body() dto?: CreateAlbumTokenDto,
  ): Promise<AlbumTokenResponseDto> {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.generateAlbumToken(albumId, clientId, userId, dto?.expiresInDays);
  }

  @Delete(':albumId/token')
  @ApiOperation({ summary: 'Revoke all access tokens for album' })
  @ApiResponse({ status: 200, type: DeleteAlbumResponseDto })
  async revokeAlbumToken(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<DeleteAlbumResponseDto> {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.revokeAlbumToken(albumId, clientId, userId);
  }

  // ---------------------------------------------------------------------------
  // External ID routes
  // ---------------------------------------------------------------------------

  @Get('external/:externalAlbumId')
  @ApiOperation({ summary: 'Get album by external ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumWithItemsByExternalId(externalAlbumId, clientId, userId);
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
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.updateAlbumByExternalId(externalAlbumId, clientId, userId, dto);
  }

  @Post('external/:externalAlbumId/items')
  @ApiOperation({ summary: 'Add items to album by external ID' })
  @ApiResponse({ status: 201, type: AddAlbumItemsResponseDto })
  async addItemsToAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: AddAlbumItemsDto,
  ): Promise<AddAlbumItemsResponseDto> {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.addItemsToAlbumByExternalId(externalAlbumId, clientId, dto.items, { userId });
  }

  @Delete('external/:externalAlbumId/items')
  @ApiOperation({ summary: 'Remove items from album by external ID' })
  @ApiBody({ type: RemoveAlbumItemsDto })
  async removeItemsFromAlbumByExternalId(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('externalAlbumId') externalAlbumId: string,
    @Body() dto: RemoveAlbumItemsDto,
  ) {
    if (!userId) throw new BadRequestException('User ID is required (X-User-Id header)');
    return this.albumService.removeItemsFromAlbumByExternalId(externalAlbumId, clientId, dto.items, { userId });
  }
}
