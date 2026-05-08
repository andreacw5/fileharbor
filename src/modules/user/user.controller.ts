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
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { ClientId } from '@/modules/client/decorators/client.decorator';
import { ClientInterceptor } from '@/modules/client/interceptors/client.interceptor';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserByExternalIdDto } from './dto/update-user-by-external-id.dto';
import { CreateUserDto } from './dto/create-user.dto';


@ApiTags('Users')
@ApiSecurity('api-key')
@Controller('users')
@UseInterceptors(ClientInterceptor)
export class UserClientController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'List users for this client (email is never returned)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-API-Key header' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by externalUserId or username' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  listUsers(
    @ClientId() clientId: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ) {
    return this.userService.listUsersForClient(clientId, { search, page, perPage });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a user for this client' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid payload or reserved externalUserId' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-API-Key header' })
  @ApiResponse({ status: 409, description: 'User with that externalUserId already exists' })
  createUser(
    @ClientId() clientId: string,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    return this.userService.createUserForClient(clientId, dto);
  }

  @Patch('external/:externalUserId')
  @ApiOperation({ summary: 'Sync user username/email by externalUserId' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid payload or no fields to update' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-API-Key header' })
  @ApiResponse({ status: 404, description: 'User not found for this client' })
  updateUserByExternalUserId(
    @ClientId() clientId: string,
    @Param('externalUserId') externalUserId: string,
    @Body() dto: UpdateUserByExternalIdDto,
  ): Promise<UserResponseDto> {
    return this.userService.updateUserByExternalUserId(clientId, externalUserId, dto);
  }
}

