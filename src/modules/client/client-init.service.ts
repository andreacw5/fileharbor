import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ClientService } from './client.service';
import { maskApiKey } from '@/modules/admin/helpers/mask-api-key.helper';

@Injectable()
export class ClientInitService implements OnModuleInit {
  private readonly logger = new Logger(ClientInitService.name);

  constructor(
    private prisma: PrismaService,
    private clientService: ClientService,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultClient();
  }

  /**
   * Seed the default client (and, via ClientService, its creators) on an empty DB.
   */
  private async initializeDefaultClient() {
    try {
      if ((await this.prisma.client.count()) > 0) return;

      const defaultClient = await this.clientService.createClient({
        name: 'Default Client',
        domain: 'default.fileharbor.local',
        active: true,
      });
      // Never the key itself: logs outlive the secret. Read it from the clients table.
      this.logger.log(
        `Empty database: created default client ${defaultClient.id} (API key ${maskApiKey(defaultClient.apiKey)})`,
      );
    } catch (error) {
      this.logger.error('Error initializing default client:', error);
      // Don't throw - allow app to start even if initialization fails
    }
  }
}
