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
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import {
  AdminBookmarkListResponseDto,
  AdminBookmarkResponseDto,
  AdminDeleteResponseDto,
  AdminCreatorBookmarkResponseDto,
  AdminVideoBookmarkListResponseDto,
  AdminVideoBookmarkResponseDto,
} from '../dto/admin-response.dto';
import { BookmarksService } from '@/modules/bookmarks/bookmarks.service';

@ApiTags('Admin - Bookmarks')
@Controller('admin/bookmarks')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-media.manage')
export class BookmarksAdminController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'List bookmarked images for admin GUI' })
  @ApiQuery({
    name: 'clientId',
    required: false,
    description: 'Filter by client ID',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by original filename',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    isArray: true,
    description: 'Filter by tags',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminBookmarkListResponseDto })
  async listBookmarks(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string | string[],
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AdminBookmarkListResponseDto> {
    const tagsArray = tags
      ? Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
      : undefined;

    const result = await this.bookmarksService.listBookmarks(adminUser, {
      clientId,
      search,
      tags: tagsArray,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });

    return plainToInstance(AdminBookmarkListResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }

  @Post(':imageId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark an image for the current admin' })
  @ApiResponse({ status: 201, type: AdminBookmarkResponseDto })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async bookmarkImage(
    @Param('imageId') imageId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminBookmarkResponseDto> {
    const bookmark = await this.bookmarksService.bookmarkImage(
      adminUser,
      imageId,
    );

    return plainToInstance(AdminBookmarkResponseDto, bookmark, {
      excludeExtraneousValues: true,
    });
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an image from admin bookmarks' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async removeBookmark(
    @Param('imageId') imageId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const result = await this.bookmarksService.removeBookmark(
      adminUser,
      imageId,
    );

    return plainToInstance(
      AdminDeleteResponseDto,
      {
        success: true,
        message:
          result.removed > 0
            ? 'Bookmark removed successfully'
            : 'Bookmark not found',
      },
      { excludeExtraneousValues: true },
    );
  }

  @Post('creators/:creatorId')
  @RequirePermission('fileharbor-library.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark a creator for the current admin' })
  @ApiResponse({ status: 201, type: AdminCreatorBookmarkResponseDto })
  @ApiResponse({ status: 404, description: 'Creator not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async bookmarkCreator(
    @Param('creatorId') creatorId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminCreatorBookmarkResponseDto> {
    const bookmark = await this.bookmarksService.bookmarkCreator(
      adminUser,
      creatorId,
    );

    return plainToInstance(AdminCreatorBookmarkResponseDto, bookmark, {
      excludeExtraneousValues: true,
    });
  }

  @Delete('creators/:creatorId')
  @RequirePermission('fileharbor-library.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a creator from admin bookmarks' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @ApiResponse({ status: 404, description: 'Creator not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async removeCreatorBookmark(
    @Param('creatorId') creatorId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const result = await this.bookmarksService.removeCreatorBookmark(
      adminUser,
      creatorId,
    );

    return plainToInstance(
      AdminDeleteResponseDto,
      {
        success: true,
        message:
          result.removed > 0
            ? 'Bookmark removed successfully'
            : 'Bookmark not found',
      },
      { excludeExtraneousValues: true },
    );
  }

  @Get('videos')
  @RequirePermission('fileharbor-library.manage')
  @ApiOperation({ summary: 'List bookmarked videos for admin GUI' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, type: AdminVideoBookmarkListResponseDto })
  async listVideoBookmarks(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AdminVideoBookmarkListResponseDto> {
    const result = await this.bookmarksService.listVideoBookmarks(adminUser, {
      clientId,
      search,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });

    return plainToInstance(AdminVideoBookmarkListResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }

  @Post('videos/:videoId')
  @RequirePermission('fileharbor-library.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark a video for the current admin' })
  @ApiResponse({ status: 201, type: AdminVideoBookmarkResponseDto })
  async bookmarkVideo(
    @Param('videoId') videoId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminVideoBookmarkResponseDto> {
    const bookmark = await this.bookmarksService.bookmarkVideo(
      adminUser,
      videoId,
    );
    return plainToInstance(AdminVideoBookmarkResponseDto, bookmark, {
      excludeExtraneousValues: true,
    });
  }

  @Delete('videos/:videoId')
  @RequirePermission('fileharbor-library.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a video from admin bookmarks' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  async removeVideoBookmark(
    @Param('videoId') videoId: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const result = await this.bookmarksService.removeVideoBookmark(
      adminUser,
      videoId,
    );

    return plainToInstance(
      AdminDeleteResponseDto,
      {
        success: true,
        message:
          result.removed > 0
            ? 'Bookmark removed successfully'
            : 'Bookmark not found',
      },
      { excludeExtraneousValues: true },
    );
  }
}
