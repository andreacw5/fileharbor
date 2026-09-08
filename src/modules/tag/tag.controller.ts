import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TagService } from './tag.service';
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { TagPageParams, TagsResponseDto } from './dto/tag-response.dto';
import { PaginatedResult } from '@/common/pagination';
import { TagListItemDto } from './dto/tag-response.dto';

@ApiTags('Admin - Tags')
@Controller('admin/tags')
export class TagController {
  constructor(private readonly tagAdminService: TagService) {}

  @Get()
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List image tags (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Scope to a specific client' })
  @ApiQuery({ name: 'search', required: false, description: 'Filter tags by partial match' })
  @ApiResponse({ status: 200, type: TagsResponseDto })
  listTags(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query() params: TagPageParams = new TagPageParams(),
  ): Promise<PaginatedResult<TagListItemDto>> {
    return this.tagAdminService.listTags(adminUser, { clientId, search }, params);
  }
}

