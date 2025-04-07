import { Controller, Get, Logger, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { DomainStatisticsDto } from './dto/domain-statistics.dto';

@ApiTags('Analytics')
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
  ) {}
  private readonly logger = new Logger(AnalyticsController.name);

  @Get(':domain')
  @ApiQuery({
    name: 'days',
    description: 'Number of days to retrieve analytics for',
    example: 30,
    required: false
  })
  @ApiOkResponse({
    description: 'Domain statistics for the specified period',
    type: DomainStatisticsDto
  })
  async getDomainStats(@Param('domain') domain: string, @Query('days') days = 30) {
    this.logger.log(`Fetching domain statistics for domain: ${domain}, days: ${days}`);
    return await this.analyticsService.getDomainStatistics(domain, days);
  }
}
