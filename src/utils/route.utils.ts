import { Injectable, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pure helper — keeps the `null`/empty-string prefix edge case in one place.
 *
 * Examples:
 *   buildRoutePath('v2', 'images', '123')  → '/v2/images/123'
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
 * Injectable service that centralises `apiPrefix` and `baseUrl` resolution.
 * Provided globally via `RouteHelperModule` — no per-module import needed.
 *
 * Usage:
 *   constructor(private readonly route: RouteHelperService) {}
 *
 *   this.route.path('images', id)            // → '/v2/images/123'
 *   this.route.fullUrl('images', id)         // → 'https://cdn.example.com/v2/images/123'
 *   this.route.fullUrl('images', id, '?thumb=true')  // append query manually if needed
 */
@Injectable()
export class RouteHelperService {
  readonly apiPrefix: string;
  readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiPrefix = config.get<string>('apiPrefix') ?? 'v2';
    this.baseUrl = config.get<string>('BASE_URL') ?? 'http://localhost:3000';
  }

  /** Returns the route path, e.g. `/v2/images/abc` */
  path(...segments: string[]): string {
    return buildRoutePath(this.apiPrefix, ...segments);
  }

  /** Returns the absolute URL, e.g. `https://cdn.example.com/v2/images/abc` */
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
