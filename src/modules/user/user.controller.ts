import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { AdminJwtGuard, AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin/decorators/admin-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('Admin')
@Controller('admin/users')
export class UserController {
  constructor(private readonly userAdminService: UserService) {}

  @Get()
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users (scoped to accessible clients, system user excluded)' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Scope to a specific client' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by externalUserId or username' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated user list (email is never returned)' })
  listUsers(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.userAdminService.listUsers(adminUser, {
      clientId,
      search,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Get(':id')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user details by internal UUID (email and sensitive data excluded)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getUser(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<UserResponseDto> {
    return this.userAdminService.getUser(id, adminUser);
  }
}

