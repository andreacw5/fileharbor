import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/modules/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminInitService implements OnModuleInit {
  private readonly logger = new Logger(AdminInitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultAdminUser();
  }

  private async initializeDefaultAdminUser() {
    try {
      const count = await this.prisma.adminUser.count();

      if (count > 0) {
        this.logger.log('Admin users already exist. Skipping initialization.');
        return;
      }

      const email = this.config.get<string>('ADMIN_DEFAULT_EMAIL');
      const password = this.config.get<string>('ADMIN_DEFAULT_PASSWORD');
      const name = this.config.get<string>('ADMIN_DEFAULT_NAME') || 'Super Admin';

      if (!email || !password) {
        this.logger.warn(
          'No admin users found and ADMIN_DEFAULT_EMAIL / ADMIN_DEFAULT_PASSWORD are not set. ' +
          'Set these env variables to auto-create the first SUPER_ADMIN on startup.',
        );
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const adminUser = await this.prisma.adminUser.create({
        data: {
          email,
          passwordHash,
          name,
          role: 'SUPER_ADMIN',
          allClientsAccess: true,
        },
      });

      this.logger.log(`Default SUPER_ADMIN created: ${adminUser.email} (ID: ${adminUser.id})`);
      this.logger.warn(
        'Remember to change the default admin password after first login!',
      );
    } catch (error) {
      this.logger.error('Error initializing default admin user:', error);
      // Don't throw — allow app to start even if initialization fails
    }
  }
}

