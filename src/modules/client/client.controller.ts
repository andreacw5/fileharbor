import { Controller, Get, UseInterceptors } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

import { ClientService } from './client.service';
import { ClientId } from './decorators/client.decorator';
import { ClientInterceptor } from './interceptors/client.interceptor';
import { ClientStatsResponseDto } from './dto/client-stats-response.dto';

@ApiTags('Client')
@UseInterceptors(ClientInterceptor)
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get client statistics',
    description:
      'Get statistics for the authenticated client including image count, album count, storage usage, and top downloaded images.',
  })
  @ApiResponse({ status: 200, type: ClientStatsResponseDto })
  async getStats(
    @ClientId() clientId: string,
  ): Promise<ClientStatsResponseDto> {
    return this.clientService.getStats(clientId);
  }
}
