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
    const externalCreatorIdHeader = request.headers['x-user-id'];

    if (!apiKey) {
      throw new UnauthorizedException('API key required (X-API-Key header)');
    }

    // Validate client by API key
    const client = await this.clientService.validateClient(apiKey);

    // Attach client info to request
    request.clientId = client.id;
    request.client = client;

    // Resolve the creator's external id. The wire names stay `X-User-Id` /
    // `externalUserId`: they name a creator in the *calling* system, which
    // FileHarbor records as a Creator.
    let externalCreatorId = externalCreatorIdHeader;
    if (!externalCreatorId) {
      externalCreatorId =
        request.query?.externalUserId || request.body?.externalUserId;
    }
    // Treat empty string as missing
    if (
      typeof externalCreatorId === 'string' &&
      externalCreatorId.trim() === ''
    ) {
      externalCreatorId = undefined;
    }
    // Services handle creator lookup/creation from here
    request.externalCreatorId = externalCreatorId;

    return next.handle();
  }
}
