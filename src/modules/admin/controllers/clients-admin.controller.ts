import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminUser } from '@/modules/admin-auth/decorators/admin-user.decorator';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { AdminCreateClientDto } from '../dto/admin-create-client.dto';
import { AdminUpdateClientDto } from '../dto/admin-update-client.dto';
import { AdminClientResponseDto, AdminClientCreatedResponseDto } from '../dto/admin-response.dto';
import { ClientService } from '@/modules/client/client.service';
import { plainToInstance } from 'class-transformer';
import { assertClientAccess, resolveAllowedClients } from '../helpers/admin-access.helper';

@ApiTags('Admin - Clients')
@Controller('admin/clients')
@UseGuards(AdminJwtGuard)
@ApiBearerAuth()
export class ClientsAdminController {
  private readonly logger = new Logger(ClientsAdminController.name);

  constructor(private readonly clientService: ClientService) {}

  @Get()
  @ApiOperation({ summary: 'List accessible clients with their stats' })
  @ApiResponse({ status: 200, type: [AdminClientResponseDto] })
  async listClients(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminClientResponseDto[]> {
    const allowed = resolveAllowedClients(adminUser);
    const clients = await this.clientService.listClientsWithStats(allowed);
    return clients.map((c) =>
      plainToInstance(AdminClientResponseDto, c, { excludeExtraneousValues: true }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get client details' })
  @ApiResponse({ status: 200, type: AdminClientResponseDto })
  async getClient(
    @Param('id') id: string,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    assertClientAccess(adminUser, id);
    const client = await this.clientService.getClientWithStats(id);
    if (!client) throw new NotFoundException('Client not found');
    return plainToInstance(AdminClientResponseDto, client, { excludeExtraneousValues: true });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new client (SUPER_ADMIN only)' })
  @ApiResponse({ status: 201, type: AdminClientCreatedResponseDto })
  async createClient(
    @Body() dto: AdminCreateClientDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminClientCreatedResponseDto> {
    if (adminUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN can create clients');
    }

    const created = await this.clientService.createClient({
      name: dto.name,
      domain: dto.domain,
      active: dto.active,
      bastionTenantSlug: dto.bastionTenantSlug,
    });

    const withStats = await this.clientService.getClientWithStats(created.id);
    this.logger.log(`[Admin] Client created: ${created.id}`);
    return plainToInstance(AdminClientCreatedResponseDto, withStats, {
      excludeExtraneousValues: true,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client name, status, webhook and Tinify settings' })
  @ApiResponse({ status: 200, type: AdminClientResponseDto })
  async updateClient(
    @Param('id') id: string,
    @Body() dto: AdminUpdateClientDto,
    @AdminUser() adminUser: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    assertClientAccess(adminUser, id);

    const exists = await this.clientService.getClientById(id);
    if (!exists) throw new NotFoundException('Client not found');

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.webhookEnabled !== undefined) data.webhookEnabled = dto.webhookEnabled;
    if ('webhookUrl' in dto) data.webhookUrl = dto.webhookUrl ?? null;
    if (dto.tinifyActive !== undefined) data.tinifyActive = dto.tinifyActive;
    if ('tinifyApiKey' in dto) data.tinifyApiKey = dto.tinifyApiKey ?? null;
    if (dto.currentTinifyUsage !== undefined) data.currentTinifyUsage = dto.currentTinifyUsage;
    if (dto.currentTinifyLimit !== undefined) data.currentTinifyLimit = dto.currentTinifyLimit;
    if ('bastionTenantSlug' in dto) data.bastionTenantSlug = dto.bastionTenantSlug ?? null;

    const updated = await this.clientService.updateClientWithStats(id, data);
    this.logger.log(`[Admin] Client updated: ${id}`);
    return plainToInstance(AdminClientResponseDto, updated, { excludeExtraneousValues: true });
  }
}

