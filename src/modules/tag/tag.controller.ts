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
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin/decorators/admin-user.decorator';
import { TagsResponseDto } from './dto/tag-response.dto';

@ApiTags('Admin')
@Controller('admin/tags')
export class TagController {
  constructor(private readonly tagAdminService: TagService) {}

  @Get()
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List distinct image tags (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Scope to a specific client' })
  @ApiQuery({ name: 'search', required: false, description: 'Filter tags by partial match' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max tags to return (default 200, max 500)' })
  @ApiResponse({ status: 200, type: TagsResponseDto })
  listTags(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<TagsResponseDto> {
    return this.tagAdminService.listTags(adminUser, {
      clientId,
      search,
      limit: Number(limit) || undefined,
    });
  }
}

