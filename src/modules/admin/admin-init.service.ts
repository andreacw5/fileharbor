import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class AdminInitService implements OnModuleInit {
  private readonly logger = new Logger(AdminInitService.name);

  onModuleInit() {
    this.logger.log(
      'Admin auth delegated to Bastion IdP. ' +
      'Create admin users in Bastion with an appSlug listed in ADMIN_ACCEPTED_APP_SLUGS. ' +
      'AdminUser records are auto-created on login via /admin/auth/login — a user who only ' +
      'presents a token issued elsewhere (e.g. Meridian) needs their record provisioned first.',
    );
  }
}
