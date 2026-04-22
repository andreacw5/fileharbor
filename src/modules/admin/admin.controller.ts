import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminJwtGuard, AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUser } from './decorators/admin-user.decorator';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminUpdateClientDto } from './dto/admin-update-client.dto';
import { AdminUpdateAlbumDto } from './dto/admin-update-album.dto';
import { AdminUpdateImageDto } from './dto/admin-update-image.dto';
import { AdminUploadImageDto } from './dto/admin-upload-image.dto';
import { AdminUpdateProfileDto, AdminChangePasswordDto } from './dto/admin-update-profile.dto';
import { ImageResponseDto } from '@/modules/image/dto';
import {
  AdminLoginResponseDto,
  AdminUserResponseDto,
  AdminClientResponseDto,
  AdminStatsResponseDto,
  AdminDeleteResponseDto,
  AdminTagsResponseDto,
  AdminAlbumResponseDto,
  AdminImageResponseDto,
  AdminAvatarResponseDto,
} from './dto/admin-response.dto';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Auth ──────────────────────────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login as admin user' })
  @ApiResponse({ status: 200, type: AdminLoginResponseDto })
  login(@Body() dto: AdminLoginDto): Promise<AdminLoginResponseDto> {
    return this.adminService.login(dto.email, dto.password);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  @Get('auth/me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin profile' })
  @ApiResponse({ status: 200, type: AdminUserResponseDto })
  getProfile(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminUserResponseDto> {
    return this.adminService.getProfile(adminUser);
  }

  @Patch('auth/me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current admin profile (name, email)' })
  @ApiResponse({ status: 200, type: AdminUserResponseDto })
  updateProfile(
    @AdminUser() adminUser: AdminJwtPayload,
    @Body() dto: AdminUpdateProfileDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminService.updateProfile(adminUser, dto);
  }

  @Post('auth/me/change-password')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current admin password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect or passwords do not match' })
  changePassword(
    @AdminUser() adminUser: AdminJwtPayload,
    @Body() dto: AdminChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.adminService.changePassword(adminUser, dto.currentPassword, dto.newPassword);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  @Get('stats')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get statistics (scoped to accessible clients)' })
  @ApiResponse({ status: 200, type: AdminStatsResponseDto })
  getGlobalStats(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminStatsResponseDto> {
    return this.adminService.getGlobalStats(adminUser);
  }

  // ─── Clients ──────────────────────────────────────────────────────────────

  @Get('clients')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List accessible clients with their stats' })
  @ApiResponse({ status: 200, type: [AdminClientResponseDto] })
  listClients(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminClientResponseDto[]> {
    return this.adminService.listClients(adminUser);
  }

  @Get('clients/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get client details' })
  @ApiResponse({ status: 200, type: AdminClientResponseDto })
  getClient(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    return this.adminService.getClient(id, adminUser);
  }

  @Patch('clients/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update client name, status, webhook settings' })
  @ApiResponse({ status: 200, type: AdminClientResponseDto })
  updateClient(
    @Param('id') id: string,
    @Body() dto: AdminUpdateClientDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    return this.adminService.updateClient(id, dto, adminUser);
  }

  // ─── Images ───────────────────────────────────────────────────────────────

  @Post('images')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload an image on behalf of a client',
    description: 'Admin-only upload. Specify the target clientId in the form body. Admin JWT replaces the API key.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'clientId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image file' },
        clientId: { type: 'string', format: 'uuid', description: 'Target client ID' },
        externalUserId: { type: 'string', description: 'External user ID (defaults to system)' },
        albumId: { type: 'string', description: 'Album UUID' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        isPrivate: { type: 'boolean', default: false },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Uploaded successfully', type: ImageResponseDto })
  @ApiResponse({ status: 400, description: 'No file or invalid format' })
  @ApiResponse({ status: 403, description: 'Admin has no access to the given client' })
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AdminUploadImageDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<ImageResponseDto> {
    return this.adminService.uploadImage(file, dto, adminUser);
  }

  @Get('images')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List images (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'albumId', required: false })
  @ApiQuery({ name: 'name', required: false, description: 'Search by original filename' })
  @ApiQuery({ name: 'tags', required: false, isArray: true, description: 'Filter by tags' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  listImages(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('albumId') albumId?: string,
    @Query('name') name?: string,
    @Query('tags') tags?: string | string[],
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const tagsArray = tags
      ? Array.isArray(tags) ? tags : tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    return this.adminService.listImages(adminUser, {
      clientId,
      userId,
      albumId,
      name,
      tags: tagsArray,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Get('images/tags')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List distinct image tags (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Scope to a specific client' })
  @ApiQuery({ name: 'search', required: false, description: 'Filter tags by partial match' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max tags to return (default 200, max 500)' })
  @ApiResponse({ status: 200, type: AdminTagsResponseDto })
  listTags(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminTagsResponseDto> {
    return this.adminService.listTags(adminUser, {
      clientId,
      search,
      limit: Number(limit) || undefined,
    });
  }

  @Delete('images/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force delete an image (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  deleteImage(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    return this.adminService.deleteImage(id, adminUser);
  }

  @Get('images/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get image details' })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  getImage(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    return this.adminService.getImage(id, adminUser);
  }

  @Patch('images/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update image metadata (originalName, isPrivate, tags, description)' })
  @ApiResponse({ status: 200, type: AdminImageResponseDto })
  updateImage(
    @Param('id') id: string,
    @Body() dto: AdminUpdateImageDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    return this.adminService.updateImage(id, dto, adminUser);
  }

  // ─── Avatars ──────────────────────────────────────────────────────────────

  @Get('avatars')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List avatars (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  listAvatars(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.adminService.listAvatars(adminUser, {
      clientId,
      userId,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Delete('avatars/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force delete an avatar (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  deleteAvatar(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    return this.adminService.deleteAvatar(id, adminUser);
  }

  @Get('avatars/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get avatar details' })
  @ApiResponse({ status: 200, type: AdminAvatarResponseDto })
  getAvatar(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAvatarResponseDto> {
    return this.adminService.getAvatar(id, adminUser);
  }

  // ─── Albums ───────────────────────────────────────────────────────────────

  @Get('albums')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List albums (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Search by album name' })
  @ApiQuery({ name: 'public', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  listAlbums(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('public') publicFilter?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const publicBool =
      publicFilter === 'true' ? true : publicFilter === 'false' ? false : undefined;
    return this.adminService.listAlbums(adminUser, {
      clientId,
      userId,
      search,
      public: publicBool,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Delete('albums/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force delete an album (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  deleteAlbum(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    return this.adminService.deleteAlbum(id, adminUser);
  }

  @Get('albums/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get album details' })
  @ApiResponse({ status: 200, type: AdminAlbumResponseDto })
  getAlbum(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    return this.adminService.getAlbum(id, adminUser);
  }

  @Patch('albums/:id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update album name, description or visibility' })
  @ApiResponse({ status: 200, type: AdminAlbumResponseDto })
  updateAlbum(
    @Param('id') id: string,
    @Body() dto: AdminUpdateAlbumDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    return this.adminService.updateAlbum(id, dto, adminUser);
  }
}

