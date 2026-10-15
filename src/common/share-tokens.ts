import { ArgumentsHost, Catch } from '@nestjs/common';
import { AllExceptionsFilter } from '@heyatom/nest-common';

/**
 * Share tokens grant read access to a private image or album: keep them out of
 * the log sink. They travel as `?token=` on GET /images/:id and as the last
 * path segment of GET /albums/shared/:token.
 */
export function sanitizeLoggedUrl(url: string): string {
  const [path, query] = url.split('?');
  const safePath = path.replace(/\/shared\/[^/]+/, '/shared/[REDACTED]');
  if (!query) return safePath;

  const params = new URLSearchParams(query);
  if (params.has('token')) params.set('token', '[REDACTED]');
  return `${safePath}?${params.toString()}`;
}

/**
 * `AllExceptionsFilter`, with the request URL sanitized while it logs.
 *
 * TODO(nest-common): the package filter logs `req.url`'s raw path on every
 * 401/403/429/5xx, so an expired share token (403) or a DB outage (500) on
 * GET /albums/shared/:token would write the token to the logs. Drop this
 * subclass once the filter logs the route pattern (or takes a URL sanitizer).
 */
@Catch()
export class ShareTokenSafeExceptionsFilter extends AllExceptionsFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const req =
      host.getType() === 'http'
        ? host.switchToHttp().getRequest<{ url?: string }>()
        : undefined;
    const url = req?.url;
    if (req && url) req.url = sanitizeLoggedUrl(url);
    try {
      super.catch(exception, host);
    } finally {
      // The response is already written (synchronously); routing and pino-http's
      // request line read originalUrl, but restore anyway.
      if (req && url) req.url = url;
    }
  }
}
