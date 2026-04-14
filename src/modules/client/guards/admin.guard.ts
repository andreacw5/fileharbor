import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-admin-secret'];
    const expected = this.config.get<string>('adminSecret');

    if (!secret || secret !== expected) {
      throw new UnauthorizedException('Invalid or missing admin secret (X-Admin-Secret header)');
    }

    return true;
  }
}

