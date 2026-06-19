import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class AdminInitService implements OnModuleInit {
  private readonly logger = new Logger(AdminInitService.name);

  onModuleInit() {
    this.logger.log(
      'Admin auth delegated to Bastion IdP. ' +
      'Create admin users in Bastion with appSlug matching BASTION_APP_SLUG. ' +
      'AdminUser records are auto-created on first login.',
    );
  }
}
