import {
  Controller,
  Get,
  Param,
  UseInterceptors,
  ClassSerializerInterceptor,
  Logger,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBasicAuth,
  ApiHeaders,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import OwnersService from './owners.service';

@Controller()
@ApiTags('Owners')
@UseInterceptors(ClassSerializerInterceptor)
export default class OwnersController {
  constructor(private readonly ownersService: OwnersService) {}
  private readonly logger = new Logger(OwnersController.name);

  @Get()
  @ApiOperation({ summary: 'Get all owners' })
  @ApiHeaders([
    {
      name: 'X-API-KEY',
      description: 'Auth API key',
    },
  ])
  @ApiBasicAuth('api-key')
  @UseGuards(AuthGuard('api-key'))
  async getAllOwners() {
    this.logger.log(`Received a request to get all owners`);
    return this.ownersService.getAllOwners({});
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get owner by id' })
  async getOwnerById(@Param('id') id: string) {
    this.logger.debug(`Received request for owner with id: ${id}`);
    return await this.ownersService.getOwnerById(id);
  }
}
