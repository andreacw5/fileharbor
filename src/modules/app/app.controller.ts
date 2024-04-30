import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/v1/status')
  @ApiOperation({ summary: 'Get the API status' })
  getStatus(): { status: string } {
    return this.appService.getStatus();
  }
}
