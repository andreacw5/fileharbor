import { Injectable, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pure helper — keeps the `null`/empty-string prefix edge case in one place.
 *
 * Examples:
 *   buildRoutePath('v1', 'images', '123')  → '/v1/images/123'
 *   buildRoutePath('',   'images', '123')  → '/images/123'
 *   buildRoutePath(null, 'images', '123')  → '/images/123'
 */
export function buildRoutePath(
  apiPrefix: string | null | undefined,
  ...segments: string[]
): string {
  const parts = [apiPrefix, ...segments].filter(Boolean);
  return '/' + parts.join('/');
}

/**
 * How a client is named in public URLs and on disk: its domain, else its id.
 * Same rule as the storage dir (`storage/{client.domain || clientId}`).
 */
export function clientRef(client: {
  id: string;
  domain?: string | null;
}): string {
  return client.domain || client.id;
}

/**
 * Injectable service that centralises `apiPrefix` and `baseUrl` resolution.
 * Every URL FileHarbor returns goes through it: never concatenate a prefix by hand.
 * Provided globally via `RouteHelperModule` — no per-module import needed.
 *
 * Usage:
 *   constructor(private readonly route: RouteHelperService) {}
 *
 *   this.route.path('images', id)            // → '/images/123'
 *   this.route.fullUrl('images', id)         // → 'https://cdn.example.com/images/123'
 *
 * Segments are joined with `/`, so a query string cannot be passed as one —
 * `fullUrl('images', id, '?thumb=true')` yields `.../images/123/?thumb=true`.
 * Append it to the result instead:
 *
 *   `${this.route.fullUrl('images', id)}?thumb=true`
 */
@Injectable()
export class RouteHelperService {
  readonly apiPrefix: string;
  readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiPrefix = config.get<string>('apiPrefix') ?? '';
    // `https://cdn.example.com/` would otherwise yield `//images/...`
    this.baseUrl = (
      config.get<string>('BASE_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  /** Returns the route path, e.g. `/images/abc` (`/{prefix}/images/abc` with API_PREFIX) */
  path(...segments: string[]): string {
    return buildRoutePath(this.apiPrefix, ...segments);
  }

  /** Returns the absolute URL, e.g. `https://cdn.example.com/images/abc` */
  fullUrl(...segments: string[]): string {
    return `${this.baseUrl}${this.path(...segments)}`;
  }
}

@Global()
@Module({
  providers: [RouteHelperService],
  exports: [RouteHelperService],
})
export class RouteHelperModule {}
