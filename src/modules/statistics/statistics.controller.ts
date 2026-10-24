import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StatisticsService } from './statistics.service';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { AdminStatsResponseDto } from '@/modules/admin/dto/admin-response.dto';
import { ApiPaginatedResponse, PaginatedResult } from '@heyatom/nest-common';
import {
  CreatorStorageDto,
  CreatorStorageQuery,
  StorageReportDto,
  StorageReportQuery,
} from './dto/storage-report.dto';

@ApiTags('Admin - Statistics')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/stats')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  @UseGuards(BastionUserGuard)
  @RequirePermission('fileharbor-media.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get statistics (scoped to accessible clients)' })
  @ApiResponse({ status: 200, type: AdminStatsResponseDto })
  getGlobalStats(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminStatsResponseDto> {
    return this.statisticsService.getGlobalStats(adminUser);
  }

  @Get('storage')
  @UseGuards(BastionUserGuard)
  @RequirePermission('fileharbor-media.manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Storage per day and kind (snapshots) and per client (live)',
    description:
      'Bytes of the originals: thumbnails and cached variants are not counted.',
  })
  @ApiResponse({ status: 200, type: StorageReportDto })
  @ApiResponse({
    status: 400,
    description: 'Bad range (to < from, > 366 days)',
  })
  @ApiResponse({ status: 403, description: 'clientId out of scope' })
  getStorageReport(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: StorageReportQuery,
  ): Promise<StorageReportDto> {
    return this.statisticsService.getStorageReport(adminUser, query);
  }

  @Get('storage/creators')
  @UseGuards(BastionUserGuard)
  // The console's creator list lives under library.manage: so does this ranking
  @RequirePermission('fileharbor-library.manage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Live storage per creator, biggest first' })
  @ApiPaginatedResponse(CreatorStorageDto)
  @ApiResponse({ status: 403, description: 'clientId out of scope' })
  getCreatorStorage(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: CreatorStorageQuery,
  ): Promise<PaginatedResult<CreatorStorageDto>> {
    return this.statisticsService.getCreatorStorage(adminUser, query);
  }
}
