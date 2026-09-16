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
import { CreatorService } from '@/modules/creator/creator.service';
import { CreatorResponseDto } from '@/modules/creator/dto/creator-response.dto';
import { UpdateCreatorAdminDto } from '@/modules/creator/dto/update-creator-admin.dto';
import { CreateCreatorAdminDto } from '@/modules/admin/dto/create-creator-admin.dto';

@ApiTags('Admin - Creators')
@Controller('admin/creators')
@UseGuards(BastionUserGuard)
@ApiBearerAuth()
@RequirePermission('fileharbor-library.manage')
export class CreatorsAdminController {
  constructor(private readonly creatorService: CreatorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new creator for a client' })
  @ApiResponse({ status: 201, type: CreatorResponseDto })
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
  createUser(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Body() dto: CreateCreatorAdminDto,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.createUserAdmin(adminUser, dto.clientId, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List creators (scoped to accessible clients, system creator excluded)',
  })
  @ApiQuery({
    name: 'clientId',
    required: false,
    description: 'Scope to a specific client',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by externalId or username',
  })
  @ApiQuery({
    name: 'isBookmarked',
    required: false,
    type: Boolean,
    description:
      'If true, returns only creators bookmarked by the current admin',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'perPage', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Paginated creator list (email is never returned)',
  })
  listUsers(
    @CurrentAdminUser() adminUser: AdminJwtPayload,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('isBookmarked') isBookmarked?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const bookmarkedOnly =
      isBookmarked !== undefined &&
      ['true', '1'].includes(isBookmarked.toLowerCase());

    return this.creatorService.listUsers(adminUser, {
      clientId,
      search,
      ...(bookmarkedOnly && { isBookmarked: true }),
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get creator details by internal UUID (email and sensitive data excluded)',
  })
  @ApiResponse({ status: 200, type: CreatorResponseDto })
  @ApiResponse({ status: 404, description: 'Creator not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  getUser(
    @Param('id') id: string,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.getUser(id, adminUser);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update creator details (externalId, email, username)',
    description:
      'Admin can update creators from accessible clients. System creator cannot be updated.',
  })
  @ApiResponse({ status: 200, type: CreatorResponseDto })
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
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateCreatorAdminDto,
    @CurrentAdminUser() adminUser: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    return this.creatorService.updateUserAdmin(id, dto, adminUser);
  }
}
