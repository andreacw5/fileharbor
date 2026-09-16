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
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import {
  Audit,
  AuditRequest,
} from '@/modules/bastion/decorators/audit.decorator';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  AdminDeleteResponseDto,
  AdminAvatarResponseDto,
} from '../dto/admin-response.dto';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { plainToInstance } from 'class-transformer';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import { RouteHelperService } from '@/utils/route.utils';

@ApiTags('Admin - Avatars')
@Controller('admin/avatars')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-media.manage')
export class AvatarsAdminController {
  constructor(
    private readonly avatarService: AvatarService,
    private readonly route: RouteHelperService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List avatars (scoped to accessible clients)' })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  async listAvatars(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
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

    const { avatars, total } = await this.avatarService.findAdminAvatars(
      where,
      { skip, take },
    );

    const data = avatars.map((avatar) => {
      const externalUserId = avatar.user?.externalUserId;
      const fullPath = externalUserId
        ? this.route.fullUrl('avatars', externalUserId)
        : null;
      return { ...avatar, fullPath };
    });

    return {
      data,
      pagination: {
        page: pageNum,
        perPage: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get avatar details' })
  @ApiResponse({ status: 200, type: AdminAvatarResponseDto })
  async getAvatar(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAvatarResponseDto> {
    const avatar = await this.avatarService.getAvatarById(id);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(adminUser, avatar.clientId);

    const externalUserId = avatar.user?.externalUserId;
    const fullPath = externalUserId
      ? this.route.fullUrl('avatars', externalUserId)
      : null;

    return plainToInstance(
      AdminAvatarResponseDto,
      { ...avatar, fullPath },
      { excludeExtraneousValues: true },
    );
  }

  @Delete(':id')
  @RequirePermission('fileharbor-media.moderate')
  @ApiOperation({ summary: 'Force delete an avatar (admin)' })
  @ApiResponse({ status: 200, type: AdminDeleteResponseDto })
  @Audit('fh_avatar.deleted', {
    metadata: (_r: unknown, req: AuditRequest) => ({ avatarId: req.params.id }),
  })
  async deleteAvatar(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
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
