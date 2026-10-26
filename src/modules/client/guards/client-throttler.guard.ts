import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ClientService } from '../client.service';

// The IP throttler guards against key guessing and anonymous abuse. A request
// carrying a valid X-API-Key comes from a trusted service, often a batch job
// behind one IP: throttling it by IP turned a 34-file import into 429s.
// Invalid or missing keys stay throttled as before.
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  @Inject(ClientService) private readonly clients: ClientService;

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const apiKey = context.switchToHttp().getRequest().headers['x-api-key'];
    if (typeof apiKey !== 'string' || !apiKey) return false;
    // validateClient caches valid keys, so a burst costs one query.
    return this.clients.validateClient(apiKey).then(
      () => true,
      () => false,
    );
  }
}
