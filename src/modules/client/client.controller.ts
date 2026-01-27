import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PrismaService } from '@/modules/prisma/prisma.service';
import { ClientId } from './decorators/client.decorator';
import { ClientStatsResponseDto } from './dto/client-stats-response.dto';

@ApiTags('Client')
@Controller('client')
export class ClientController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get client statistics',
    description: 'Get statistics for the authenticated client including image count, album count, storage usage, and top downloaded images.'
  })
  @ApiResponse({ status: 200, type: ClientStatsResponseDto })
  async getStats(@ClientId() clientId: string): Promise<ClientStatsResponseDto> {
    // Aggregate stats for the specific client
    const [totalImages, totalAlbums, totalStorage, topImages] = await Promise.all([
      this.prisma.image.count({ where: { clientId } }),
      this.prisma.album.count({ where: { clientId } }),
      this.prisma.image.aggregate({
        where: { clientId },
        _sum: { size: true },
      }),
      this.prisma.image.findMany({
        where: { clientId },
        orderBy: { views: 'desc' },
        take: 5,
        select: {
          id: true,
          originalName: true,
          views: true,
          size: true,
        },
      }),
    ]);

    return {
      totalImages,
      totalAlbums,
      totalStorage: totalStorage._sum.size || 0,
      topImages,
    };
  }
}
