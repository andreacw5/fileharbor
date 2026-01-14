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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { AlbumService } from './album.service';
import { ClientInterceptor } from '@/client/interceptors/client.interceptor';
import { ClientId, UserId } from '@/client/decorators/client.decorator';
import { Public } from '@/client/decorators/public.decorator';
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
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
  @ApiOperation({ summary: 'Get album with images by ID' })
  @ApiResponse({ status: 200, type: AlbumResponseDto })
  async getAlbum(
    @ClientId() clientId: string,
    @UserId() userId: string,
    @Param('albumId') albumId: string,
  ): Promise<AlbumResponseDto> {
    return this.albumService.getAlbumWithImages(albumId, clientId, userId);
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
    return this.albumService.updateAlbum(albumId, clientId, userId, dto);
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    return this.albumService.deleteAlbum(albumId, clientId, userId);
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
    return this.albumService.addImagesToAlbum(albumId, clientId, userId, dto.imageIds);
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
    return this.albumService.removeImagesFromAlbum(albumId, clientId, userId, dto.imageIds);
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
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }
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
    if (!userId) {
      throw new BadRequestException('User ID is required (X-User-Id header)');
    }

    return this.albumService.revokeAlbumToken(albumId, clientId, userId);
  }
}

