import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TagService } from './tag.service';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { TagListItemDto, TagPageParams } from './dto/tag-response.dto';
import { ApiPaginatedResponse, PaginatedResult } from '@heyatom/nest-common';

@ApiTags('Admin - Tags')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/tags')
export class TagController {
  constructor(private readonly tagAdminService: TagService) {}

  @Get()
  @UseGuards(BastionUserGuard)
  @RequirePermission('fileharbor-media.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List image tags (scoped to accessible clients)' })
  @ApiPaginatedResponse(TagListItemDto)
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
