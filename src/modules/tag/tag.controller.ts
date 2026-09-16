import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TagService } from './tag.service';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { TagPageParams, TagsResponseDto } from './dto/tag-response.dto';
import { PaginatedResult } from '@/common/pagination';
import { TagListItemDto } from './dto/tag-response.dto';

@ApiTags('Admin - Tags')
@Controller('admin/tags')
export class TagController {
  constructor(private readonly tagAdminService: TagService) {}

  @Get()
  @UseGuards(BastionUserGuard)
  @RequirePermission('fileharbor-media.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List image tags (scoped to accessible clients)' })
  @ApiResponse({ status: 200, type: TagsResponseDto })
  listTags(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() params: TagPageParams = new TagPageParams(),
  ): Promise<PaginatedResult<TagListItemDto>> {
    return this.tagAdminService.listTags(
      adminUser,
      { clientId: params.clientId, search: params.search },
      params,
    );
  }
}
