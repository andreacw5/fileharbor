import {
  Body,
  Controller,
  Patch,
  Param,
  UseInterceptors,
} from '@nestjs/common';
import {
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


@ApiTags('Users')
@ApiSecurity('api-key')
@Controller('users')
@UseInterceptors(ClientInterceptor)
export class UserClientController {
  constructor(private readonly userService: UserService) {}

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

