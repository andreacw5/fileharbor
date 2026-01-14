import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ClientService } from './client.service';

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
   * Initialize default client and admin user if database is empty
   */
  private async initializeDefaultClient() {
    try {
      const isDevelopment = process.env.NODE_ENV === 'development';

      // Check if any clients exist
      const clientCount = await this.prisma.client.count();

      if (clientCount === 0) {
        this.logger.log('Database is empty. Creating default client and admin user...');

        // Create default client using ClientService
        const defaultClient = await this.clientService.createClient({
          name: 'Default Client',
          domain: 'default.fileharbor.local',
          active: true,
        });

        this.logger.log(`Created default client: ${defaultClient.name} (ID: ${defaultClient.id})`);
        this.logger.log(`API Key: ${defaultClient.apiKey}`);

        // Get the default users that were auto-created by ClientService
        const defaultUsers = await this.prisma.user.findMany({
          where: { clientId: defaultClient.id },
        });

        if (defaultUsers.length > 0) {
          this.logger.log(`Created ${defaultUsers.length} default users:`);
          for (const user of defaultUsers) {
            this.logger.log(`  - ${user.username} (externalUserId: ${user.externalUserId}, ID: ${user.id})`);
          }
        }

        this.logger.log('Default client initialization completed.');
      } else {
        this.logger.log(`Found ${clientCount} existing client(s). Skipping initialization.`);

        // In development mode, log existing clients info
        if (isDevelopment) {
          this.logger.log('Development mode: Logging existing clients...');
          const clients = await this.prisma.client.findMany({
            include: {
              users: true,
              _count: {
                select: {
                  images: true,
                  avatars: true,
                  albums: true,
                },
              },
            },
          });

          for (const client of clients) {
            this.logger.log(`\n--- Client: ${client.name} ---`);
            this.logger.log(`  ID: ${client.id}`);
            this.logger.log(`  API Key: ${client.apiKey}`);
            this.logger.log(`  Domain: ${client.domain || 'N/A'}`);
            this.logger.log(`  Active: ${client.active}`);
            this.logger.log(`  Images: ${client._count.images}`);
            this.logger.log(`  Avatars: ${client._count.avatars}`);
            this.logger.log(`  Albums: ${client._count.albums}`);
            this.logger.log(`  Users (${client.users.length}):`);

            for (const user of client.users) {
              this.logger.log(`    - ${user.username || user.externalUserId} (ID: ${user.id}, External: ${user.externalUserId})`);
              if (user.email) {
                this.logger.log(`      Email: ${user.email}`);
              }
            }
          }
          this.logger.log('');
        }
      }
    } catch (error) {
      this.logger.error('Error initializing default client:', error);
      // Don't throw - allow app to start even if initialization fails
    }
  }

}

