import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Patch,
  Body,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { UserService } from '@/modules/user/user.service';
import { UserResponseDto } from '@/modules/user/dto/user-response.dto';
import { UpdateUserAdminDto } from '@/modules/user/dto/update-user-admin.dto';

@ApiTags('Admin - Users')
@Controller('admin/users')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class UsersAdminController {
  constructor(private readonly userService: UserService) {}

  @Get()
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
    return this.userService.listUsers(adminUser, {
      clientId,
      search,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user details by internal UUID (email and sensitive data excluded)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getUser(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.getUser(id, adminUser);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update user details (externalUserId, email, username)',
    description: 'Admin can update users from accessible clients. System user cannot be updated.',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid data or system user update attempt' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserAdminDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.updateUserAdmin(id, dto, adminUser);
  }
}

