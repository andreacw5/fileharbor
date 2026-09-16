import { Controller, Get, UseGuards } from '@nestjs/common';
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

@ApiTags('Admin - Statistics')
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
}
