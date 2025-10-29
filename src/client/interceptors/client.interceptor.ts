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
      // Try to get client info if provided, but don't require it
      const apiKey = request.headers['x-api-key'];
      const clientIdHeader = request.headers['x-client-id'];

      if (apiKey || clientIdHeader) {
        let client;
        if (apiKey) {
          try {
            client = await this.clientService.validateClient(apiKey);
          } catch (e) {
            // Invalid API key on public endpoint, continue without client
          }
        } else if (clientIdHeader) {
          client = await this.clientService.getClientById(clientIdHeader);
        }

        if (client) {
          request.clientId = client.id;
          request.client = client;
        }
      }

      return next.handle();
    }

    // Get client ID from header or API key
    const apiKey = request.headers['x-api-key'];
    const clientIdHeader = request.headers['x-client-id'];
    const userIdHeader = request.headers['x-user-id'];

    if (!apiKey && !clientIdHeader) {
      throw new UnauthorizedException('Client authentication required');
    }

    let client;

    if (apiKey) {
      // Validate by API key
      client = await this.clientService.validateClient(apiKey);
    } else if (clientIdHeader) {
      // Direct client ID (for development/testing)
      client = await this.clientService.getClientById(clientIdHeader);
      if (!client) {
        throw new UnauthorizedException('Invalid client ID');
      }
    }

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
