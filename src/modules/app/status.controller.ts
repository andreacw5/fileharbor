import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class StatusController {
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
}
