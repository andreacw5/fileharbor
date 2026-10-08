import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '@heyatom/bastion-client/nest';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  @Public()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Always returns 200. Used by container orchestrators to check if the process is alive.',
  })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks database connectivity. Returns 200 when the service is ready to accept traffic, 503 otherwise.',
  })
  @ApiOkResponse({
    description: 'Service is ready — all health indicators passed',
  })
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
    ]);
  }
}
