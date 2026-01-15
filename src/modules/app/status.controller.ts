import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { PrismaService } from '@/modules/prisma/prisma.service';
import { StatsResponseDto } from './dto/stats-response.dto';
import { ClientId } from '@/modules/client/decorators/client.decorator';

@ApiTags('App')
@Controller()
export class StatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Health check',
    description: 'Simple health check endpoint to verify the API is running.',
  })
  @ApiResponse({
    status: 200,
    description: 'API is operational',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          example: 'ok',
        },
      },
    },
  })
  getStatus() {
    return { status: 'ok' };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get client activity dashboard stats' })
  @ApiResponse({ status: 200, type: StatsResponseDto })
  async getStats(@ClientId() clientId: string): Promise<StatsResponseDto> {

    // Aggregate stats
    const [totalImages, totalAlbums, totalStorage, topImages] = await Promise.all([
      this.prisma.image.count({ where: { clientId } }),
      this.prisma.album.count({ where: { clientId } }),
      this.prisma.image.aggregate({
        where: { clientId },
        _sum: { size: true },
      }),
      this.prisma.image.findMany({
        where: { clientId },
        orderBy: { downloads: 'desc' },
        take: 5,
        select: {
          id: true,
          originalName: true,
          downloads: true,
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
