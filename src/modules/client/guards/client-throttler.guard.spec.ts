import { ExecutionContext } from '@nestjs/common';
import { ClientThrottlerGuard } from './client-throttler.guard';

describe('ClientThrottlerGuard.shouldSkip', () => {
  const ctx = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  const guard = (valid: boolean) => {
    const g = new ClientThrottlerGuard([], {} as any, {} as any) as any;
    g.clients = {
      validateClient: jest.fn(() =>
        valid ? Promise.resolve({}) : Promise.reject(new Error('invalid')),
      ),
    };
    return g;
  };

  it('skips a valid API key', async () => {
    expect(await guard(true).shouldSkip(ctx({ 'x-api-key': 'k' }))).toBe(true);
  });

  it('throttles an invalid API key', async () => {
    expect(await guard(false).shouldSkip(ctx({ 'x-api-key': 'k' }))).toBe(
      false,
    );
  });

  it('throttles a request without a key, without a lookup', async () => {
    const g = guard(true);
    expect(await g.shouldSkip(ctx({}))).toBe(false);
    expect(g.clients.validateClient).not.toHaveBeenCalled();
  });
});
