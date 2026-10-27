import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiSecurity,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CreatorService } from './creator.service';
import { ClientId } from '@/modules/client/decorators/client.decorator';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import {
  CreatorListResponseDto,
  CreatorResponseDto,
} from './dto/creator-response.dto';
import { UpdateCreatorByExternalIdDto } from './dto/update-creator-by-external-id.dto';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { ListCreatorsDto } from './dto/list-creators.dto';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
} from '@heyatom/nest-common';

@ApiTags('Creators')
@ApiSecurity('api-key')
@Controller('creators')
@UseInterceptors(ClientInterceptor)
export class CreatorClientController {
  constructor(private readonly creatorService: CreatorService) {}

  @Get()
  @ApiOperation({
    summary: 'List creators for this client (email is never returned)',
  })
  @ApiPaginatedResponse(CreatorListResponseDto)
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  listCreators(@ClientId() clientId: string, @Query() query: ListCreatorsDto) {
    return this.creatorService.listCreatorsForClient(
      clientId,
      { search: query.search },
      query,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a creator for this client' })
  @ApiCreatedData(CreatorResponseDto)
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or reserved externalId',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  @ApiResponse({
    status: 409,
    description: 'Creator with that externalId already exists',
  })
  createCreator(
    @ClientId() clientId: string,
    @Body() dto: CreateCreatorDto,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.createCreatorForClient(clientId, dto);
  }

  @Patch('external/:externalId')
  @ApiOperation({ summary: 'Sync creator username/email by externalId' })
  @ApiOkData(CreatorResponseDto)
  @ApiResponse({
    status: 400,
    description: 'Invalid payload or no fields to update',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid X-API-Key header',
  })
  @ApiResponse({
    status: 404,
    description: 'Creator not found for this client',
  })
  updateCreatorByExternalId(
    @ClientId() clientId: string,
    @Param('externalId') externalId: string,
    @Body() dto: UpdateCreatorByExternalIdDto,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.updateCreatorByExternalId(
      clientId,
      externalId,
      dto,
    );
  }
}
