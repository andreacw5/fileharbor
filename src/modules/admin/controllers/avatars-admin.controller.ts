import { SkipThrottle } from '@nestjs/throttler';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Delete,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { CurrentAdminUser } from '@/modules/bastion/decorators/current-admin-user.decorator';
import { RequirePermission } from '@/modules/bastion/decorators/require-permission.decorator';
import { Audit, AuditRequest } from '@heyatom/bastion-client/nest';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  AdminDeleteResponseDto,
  AdminAvatarResponseDto,
  AdminAvatarListItemDto,
  AdminReoptimizeFailedResponseDto,
} from '../dto/admin-response.dto';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { plainToInstance } from 'class-transformer';
import {
  assertClientAccess,
  buildClientWhere,
} from '../helpers/admin-access.helper';
import { parseOptimizeStatusQuery } from '../helpers/admin-query.helper';
import { AdminReoptimizeFailedDto } from '../dto/admin-reoptimize-failed.dto';
import { OPTIMIZE_GIVEN_UP_WHERE } from '@/modules/storage/storage.service';
import { RouteHelperService, clientRef } from '@/utils/route.utils';
import {
  ApiOkData,
  ApiPaginatedResponse,
  paginate,
} from '@heyatom/nest-common';
import { AdminAvatarListQuery } from '../dto/admin-list-query.dto';

@ApiTags('Admin - Avatars')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
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
  @ApiPaginatedResponse(AdminAvatarListItemDto)
  async listAvatars(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminAvatarListQuery,
  ) {
    const { clientId, creatorId, search } = query;
    const where: any = buildClientWhere(adminUser, clientId);
    // The console lists avatars by username, so the search box must match it
    // too, not only the external id nobody sees.
    const q = search?.trim();
    if (creatorId || q) {
      where.creator = {
        ...(creatorId && { externalId: creatorId }),
        ...(q && {
          OR: [
            { externalId: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
          ],
        }),
      };
    }

    Object.assign(where, parseOptimizeStatusQuery(query.optimizeStatus));

    const { avatars, total } = await this.avatarService.findAdminAvatars(
      where,
      { skip: query.skip, take: query.limit },
    );

    const data = avatars.map((avatar) => {
      const externalId = avatar.creator?.externalId;
      const fullPath = externalId
        ? this.route.fullUrl(
            'avatars',
            clientRef({ id: avatar.clientId, domain: avatar.client?.domain }),
            externalId,
          )
        : null;
      return { ...avatar, fullPath };
    });

    return paginate(data, total, query);
  }

  @Post('reoptimize-failed')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-queue every avatar the optimize job gave up on',
    description:
      'Only rows at MAX_OPTIMIZE_ATTEMPTS (optimizeStatus=failed): the others are still in the queue.',
  })
  @ApiOkData(AdminReoptimizeFailedResponseDto)
  @ApiResponse({ status: 403, description: 'clientId outside your scope' })
  @Audit('fh_avatar.reoptimize_queued', {
    metadata: (r: { count: number }, req: AuditRequest) => ({
      clientId: (req.body as { clientId?: string })?.clientId,
      count: r?.count ?? 0,
    }),
  })
  async reoptimizeFailedAvatars(
    @Body() dto: AdminReoptimizeFailedDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<{ count: number }> {
    const count = await this.avatarService.resetOptimizeAttempts({
      ...buildClientWhere(adminUser, dto.clientId), // 403 on a client out of scope
      ...OPTIMIZE_GIVEN_UP_WHERE,
    });
    return { count };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get avatar details' })
  @ApiOkData(AdminAvatarResponseDto)
  async getAvatar(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminAvatarResponseDto> {
    const avatar = await this.avatarService.getAvatarById(id);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(adminUser, avatar.clientId);

    const externalId = avatar.creator?.externalId;
    const fullPath = externalId
      ? this.route.fullUrl(
          'avatars',
          clientRef({ id: avatar.clientId, domain: avatar.client?.domain }),
          externalId,
        )
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
  @ApiOkData(AdminDeleteResponseDto)
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

  @Post(':id/reoptimize')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Put an unoptimized avatar back in the optimize queue',
    description:
      'Resets optimizeAttempts; the hourly optimize job picks it up within the hour. Rows with 1-2 failed attempts can be reset too.',
  })
  @ApiResponse({ status: 204, description: 'Queued' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Avatar not found' })
  @ApiResponse({ status: 409, description: 'Avatar already optimized' })
  @Audit('fh_avatar.reoptimize_queued', {
    metadata: (_r: unknown, req: AuditRequest) => ({ avatarId: req.params.id }),
  })
  async reoptimizeAvatar(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<void> {
    const avatar = await this.avatarService.getAvatarById(id);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(adminUser, avatar.clientId);
    if (!(await this.avatarService.resetOptimizeAttempts({ id }))) {
      throw new ConflictException({
        code: 'ALREADY_OPTIMIZED',
        message: 'Avatar already optimized',
      });
    }
  }
}
