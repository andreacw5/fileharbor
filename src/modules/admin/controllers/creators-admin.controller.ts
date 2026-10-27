import { SkipThrottle } from '@nestjs/throttler';
import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
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
import { CreatorService } from '@/modules/creator/creator.service';
import {
  CreatorListResponseDto,
  CreatorResponseDto,
} from '@/modules/creator/dto/creator-response.dto';
import { UpdateCreatorAdminDto } from '@/modules/creator/dto/update-creator-admin.dto';
import { CreateCreatorAdminDto } from '@/modules/admin/dto/create-creator-admin.dto';
import { AdminCreatorListQuery } from '@/modules/admin/dto/admin-list-query.dto';
import {
  ApiCreatedData,
  ApiOkData,
  ApiPaginatedResponse,
} from '@heyatom/nest-common';

@ApiTags('Admin - Creators')
// Every console call reaches us from Meridian's BFF, one IP for every admin: an
// IP-keyed bucket would be shared by all of them. Bastion auth + permissions gate it.
@SkipThrottle()
@Controller('admin/creators')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-library.manage')
export class CreatorsAdminController {
  constructor(private readonly creatorService: CreatorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new creator for a client' })
  @ApiCreatedData(CreatorResponseDto)
  @ApiResponse({
    status: 400,
    description: 'Invalid data or reserved externalId',
  })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({
    status: 409,
    description: 'Creator already exists for this client',
  })
  @Audit('fh_creator.created', {
    metadata: (r: CreatorResponseDto) => ({
      creatorId: r.id,
      clientId: r.clientId,
      externalId: r.externalId,
    }),
  })
  createCreator(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Body() dto: CreateCreatorAdminDto,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.createCreatorAdmin(adminUser, dto.clientId, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List creators (scoped to accessible clients, system creator excluded)',
  })
  @ApiPaginatedResponse(
    CreatorListResponseDto,
    'Paginated creator list (email is never returned)',
  )
  listCreators(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query() query: AdminCreatorListQuery,
  ) {
    const bookmarkedOnly =
      query.isBookmarked !== undefined &&
      ['true', '1'].includes(query.isBookmarked.toLowerCase());

    return this.creatorService.listCreators(
      adminUser,
      {
        clientId: query.clientId,
        search: query.search,
        ...(bookmarkedOnly && { isBookmarked: true }),
      },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get creator details by internal UUID (email and sensitive data excluded)',
  })
  @ApiOkData(CreatorResponseDto)
  @ApiResponse({ status: 404, description: 'Creator not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getCreator(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.getCreator(id, adminUser);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update creator details (externalId, email, username)',
    description:
      'Admin can update creators from accessible clients. System creator cannot be updated.',
  })
  @ApiOkData(CreatorResponseDto)
  @ApiResponse({
    status: 400,
    description: 'Invalid data or system creator update attempt',
  })
  @ApiResponse({ status: 404, description: 'Creator not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @Audit('fh_creator.updated', {
    metadata: (_r: unknown, req: AuditRequest) => ({
      creatorId: req.params.id,
      fields: Object.keys((req.body ?? {}) as Record<string, unknown>),
    }),
  })
  updateCreator(
    @Param('id') id: string,
    @Body() dto: UpdateCreatorAdminDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.updateCreatorAdmin(id, dto, adminUser);
  }
}
