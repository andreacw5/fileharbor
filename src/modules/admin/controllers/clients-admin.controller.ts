import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
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
import { AdminUpdateClientDto } from '../dto/admin-update-client.dto';
import { AdminClientResponseDto } from '../dto/admin-response.dto';
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update client name, status, webhook settings' })
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

    const updated = await this.clientService.updateClientWithStats(id, data);
    this.logger.log(`[Admin] Client updated: ${id}`);
    return plainToInstance(AdminClientResponseDto, updated, { excludeExtraneousValues: true });
  }
}

