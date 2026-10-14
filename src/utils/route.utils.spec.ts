import { ConfigService } from '@nestjs/config';
import { RouteHelperService } from './route.utils';

describe('RouteHelperService', () => {
  const build = (env: Record<string, string>) =>
    new RouteHelperService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

  it('strips a trailing slash from BASE_URL', () => {
    const route = build({ BASE_URL: 'https://cdn.example.com/' });

    expect(route.fullUrl('images', 'abc')).toBe(
      'https://cdn.example.com/images/abc',
    );
  });

  it('prefixes paths with API_PREFIX', () => {
    const route = build({
      BASE_URL: 'https://cdn.example.com',
      apiPrefix: 'v1',
    });

    expect(route.fullUrl('images', 'abc')).toBe(
      'https://cdn.example.com/v1/images/abc',
    );
  });
});
