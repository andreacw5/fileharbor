import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service';
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminStatsResponseDto } from '@/modules/admin/dto/admin-response.dto';

@ApiTags('Admin')
@Controller('admin/stats')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get statistics (scoped to accessible clients)' })
  @ApiResponse({ status: 200, type: AdminStatsResponseDto })
  getGlobalStats(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminStatsResponseDto> {
    return this.statisticsService.getGlobalStats(adminUser);
  }
}

