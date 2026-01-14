import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ClientService } from '../client.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ClientInterceptor implements NestInterceptor {
  constructor(
    private clientService: ClientService,
    private reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();

    // Check if endpoint is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // For public endpoints, client authentication is optional
      // Only accept API key for authentication
      const apiKey = request.headers['x-api-key'];

      if (apiKey) {
        try {
          const client = await this.clientService.validateClient(apiKey);
          request.clientId = client.id;
          request.client = client;
        } catch (e) {
          // Invalid API key on public endpoint, continue without client
        }
      }

      return next.handle();
    }

    // Get API key from header
    const apiKey = request.headers['x-api-key'];
    const externalUserIdHeader = request.headers['x-user-id'];

    if (!apiKey) {
      throw new UnauthorizedException('API key required (X-API-Key header)');
    }

    // Validate client by API key
    const client = await this.clientService.validateClient(apiKey);

    // Attach client info to request
    request.clientId = client.id;
    request.client = client;

    // Handle external user ID if provided
    // This is the user ID from the client's system, not Fileharbor's internal user ID
    let externalUserId = externalUserIdHeader;
    if (!externalUserId) {
      externalUserId = request.query?.externalUserId || request.body?.externalUserId;
    }
    // Treat empty string as missing
    if (typeof externalUserId === 'string' && externalUserId.trim() === '') {
      externalUserId = undefined;
    }
    // Attach external user ID to request (services will handle user lookup/creation)
    request.externalUserId = externalUserId;

    return next.handle();
  }
}
