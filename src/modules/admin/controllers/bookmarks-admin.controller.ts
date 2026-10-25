import { SkipThrottle } from '@nestjs/throttler';
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
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import {
  AdminBookmarkResponseDto,
  AdminDeleteResponseDto,
  AdminCreatorBookmarkResponseDto,
  AdminVideoBookmarkResponseDto,
} from '../dto/admin-response.dto';
import {
  AdminBookmarkListQuery,
  AdminVideoBookmarkListQuery,
} from '../dto/admin-list-query.dto';
import { BookmarksService } from '@/modules/bookmarks/bookmarks.service';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
  paginate,
} from '@heyatom/nest-common';

@ApiTags('Admin - Bookmarks')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/bookmarks')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-media.manage')
export class BookmarksAdminController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'List bookmarked images for admin GUI' })
  @ApiPaginatedResponse(AdminBookmarkResponseDto)
  async listBookmarks(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminBookmarkListQuery,
  ) {
    const { tags } = query;
    const tagsArray = tags
      ? Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
      : undefined;

    const result = await this.bookmarksService.listBookmarks(
      adminUser,
      { clientId: query.clientId, search: query.search, tags: tagsArray },
      query,
    );

    return paginate(
      plainToInstance(AdminBookmarkResponseDto, result.data, {
        excludeExtraneousValues: true,
      }),
      result.meta.total,
      query,
    );
  }

  @Post(':imageId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark an image for the current admin' })
  @ApiCreatedData(AdminBookmarkResponseDto)
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
  @ApiOkData(AdminDeleteResponseDto)
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
  @ApiCreatedData(AdminCreatorBookmarkResponseDto)
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
  @ApiOkData(AdminDeleteResponseDto)
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
  @ApiPaginatedResponse(AdminVideoBookmarkResponseDto)
  async listVideoBookmarks(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminVideoBookmarkListQuery,
  ) {
    const result = await this.bookmarksService.listVideoBookmarks(
      adminUser,
      { clientId: query.clientId, search: query.search },
      query,
    );

    return paginate(
      plainToInstance(AdminVideoBookmarkResponseDto, result.data, {
        excludeExtraneousValues: true,
      }),
      result.meta.total,
      query,
    );
  }

  @Post('videos/:videoId')
  @RequirePermission('fileharbor-library.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bookmark a video for the current admin' })
  @ApiCreatedData(AdminVideoBookmarkResponseDto)
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
  @ApiOkData(AdminDeleteResponseDto)
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
