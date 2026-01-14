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
    const userIdHeader = request.headers['x-user-id'];

    if (!apiKey) {
      throw new UnauthorizedException('API key required (X-API-Key header)');
    }

    // Validate client by API key
    const client = await this.clientService.validateClient(apiKey);

    // Attach client info to request
    request.clientId = client.id;
    request.client = client;

    // Handle user if provided
    let userId = userIdHeader;
    if (!userId) {
      userId = request.query?.userId || request.body?.userId;
    }
    // Treat empty string as missing
    if (typeof userId === 'string' && userId.trim() === '') {
      userId = undefined;
    }
    if (userId) {
      const user = await this.clientService.getOrCreateUser(
        client.id,
        userId,
      );
      request.userId = user.id;
      request.user = user;
    } else {
      // Explicitly unset userId if not found
      request.userId = undefined;
      request.user = undefined;
    }

    return next.handle();
  }
}
