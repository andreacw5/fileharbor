import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import {
  AdminDeleteResponseDto,
  AdminAvatarResponseDto,
} from '../dto/admin-response.dto';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { plainToInstance } from 'class-transformer';
import { assertClientAccess, buildClientWhere } from '../helpers/admin-access.helper';

@ApiTags('Admin - Avatars')
@Controller('admin/avatars')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class AvatarsAdminController {
  constructor(
    private readonly avatarService: AvatarService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List avatars (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listAvatars(
    @AdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = Number(page) || 1;
    const take = Math.min(Number(perPage) || 20, 100);
    const skip = (pageNum - 1) * take;

    const where: any = buildClientWhere(adminUser, clientId);
    if (userId) where.user = { externalUserId: userId };

    const { avatars, total } = await this.avatarService.findAdminAvatars(where, { skip, take });

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';

    const data = avatars.map((avatar) => {
      const externalUserId = avatar.user?.externalUserId;
      const fullPath = externalUserId ? `${baseUrl}/${apiPrefix}/avatars/${externalUserId}` : null;
      return { ...avatar, fullPath };
    });

    return {
      data,
      pagination: { page: pageNum, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get avatar details' })
  @ApiResponse({ status: 200, type: AdminAvatarResponseDto })
  async getAvatar(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAvatarResponseDto> {
    const avatar = await this.avatarService.getAvatarById(id);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(adminUser, avatar.clientId);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    const externalUserId = avatar.user?.externalUserId;
    const fullPath = externalUserId ? `${baseUrl}/${apiPrefix}/avatars/${externalUserId}` : null;

    return plainToInstance(AdminAvatarResponseDto, { ...avatar, fullPath }, { excludeExtraneousValues: true });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Force delete an avatar (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  async deleteAvatar(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminDeleteResponseDto> {
    const avatar = await this.avatarService.getAvatarById(id);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(adminUser, avatar.clientId);

    await this.avatarService.deleteAvatarById(id, avatar.clientId);

    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Avatar deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }
}

