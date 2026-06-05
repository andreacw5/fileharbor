import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import {
  AdminBookmarkListResponseDto,
  AdminBookmarkResponseDto,
  AdminDeleteResponseDto,
  AdminUserBookmarkListResponseDto,
  AdminUserBookmarkResponseDto,
} from '../dto/admin-response.dto';
import { BookmarksService } from '@/modules/bookmarks/bookmarks.service';

@ApiTags('Admin - Bookmarks')
@Controller('admin/bookmarks')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class BookmarksAdminController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'List bookmarked images for admin GUI' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Filter by client ID' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by original filename' })
  @ApiQuery({ name: 'tags', required: false, isArray: true, description: 'Filter by tags' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminBookmarkListResponseDto })
  async listBookmarks(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string | string[],
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AdminBookmarkListResponseDto> {
    const tagsArray = tags
      ? Array.isArray(tags) ? tags : tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : undefined;

    const result = await this.bookmarksService.listBookmarks(adminUser, {
      clientId,
      search,
      tags: tagsArray,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });

    return plainToInstance(AdminBookmarkListResponseDto, result, { excludeExtraneousValues: true });
  }

  @Post(':imageId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark an image for the current admin' })
  @ApiResponse({ status: 201, type: AdminBookmarkResponseDto })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async bookmarkImage(
    @Param('imageId') imageId: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminBookmarkResponseDto> {
    const bookmark = await this.bookmarksService.bookmarkImage(adminUser, imageId);

    return plainToInstance(AdminBookmarkResponseDto, bookmark, { excludeExtraneousValues: true });
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an image from admin bookmarks' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async removeBookmark(
    @Param('imageId') imageId: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const result = await this.bookmarksService.removeBookmark(adminUser, imageId);

    return plainToInstance(
      AdminDeleteResponseDto,
      {
        success: true,
        message: result.removed > 0 ? 'Bookmark removed successfully' : 'Bookmark not found',
      },
      { excludeExtraneousValues: true },
    );
  }

  @Post('users/:userId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark a user for the current admin' })
  @ApiResponse({ status: 201, type: AdminUserBookmarkResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async bookmarkUser(
    @Param('userId') userId: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminUserBookmarkResponseDto> {
    const bookmark = await this.bookmarksService.bookmarkUser(adminUser, userId);

    return plainToInstance(AdminUserBookmarkResponseDto, bookmark, { excludeExtraneousValues: true });
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a user from admin bookmarks' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async removeUserBookmark(
    @Param('userId') userId: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const result = await this.bookmarksService.removeUserBookmark(adminUser, userId);

    return plainToInstance(
      AdminDeleteResponseDto,
      {
        success: true,
        message: result.removed > 0 ? 'Bookmark removed successfully' : 'Bookmark not found',
      },
      { excludeExtraneousValues: true },
    );
  }
}

