import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';

import { ClientService } from './client.service';
import { ClientId } from './decorators/client.decorator';
import { ClientInterceptor } from './interceptors/client.interceptor';
import { AdminGuard } from './guards/admin.guard';
import { ClientStatsResponseDto } from './dto/client-stats-response.dto';
import { GlobalStatsResponseDto } from './dto/global-stats-response.dto';

@ApiTags('Client')
@UseInterceptors(ClientInterceptor)
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get client statistics',
    description: 'Get statistics for the authenticated client including image count, album count, storage usage, and top downloaded images.'
  })
  @ApiResponse({ status: 200, type: ClientStatsResponseDto })
  async getStats(@ClientId() clientId: string): Promise<ClientStatsResponseDto> {
    return this.clientService.getStats(clientId);
  }

  @Get('admin/stats')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get global statistics (admin)',
    description: 'Get aggregated statistics across all clients: total image count and total disk usage. Requires X-Admin-Secret header.',
  })
  @ApiSecurity('x-admin-secret')
  @ApiResponse({ status: 200, type: GlobalStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or missing admin secret' })
  async getGlobalStats(): Promise<GlobalStatsResponseDto> {
    return this.clientService.getGlobalStats();
  }
}
