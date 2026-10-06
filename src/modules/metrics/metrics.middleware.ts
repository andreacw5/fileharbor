import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Never instrumented — polling /health/* would otherwise pollute the histogram with its own traffic. */
function isSkipped(path: string): boolean {
  return path.startsWith('/health');
}

/**
 * Observes `http_request_duration_seconds` for every request.
 *
 * A middleware, not an interceptor: interceptors run after the guards, so a
 * request that a guard rejects with 401 or the throttler with 429 never
 * reaches one — and those are exactly the statuses the alerts are for. The
 * `finish` event fires for every response, whatever produced it, and by then
 * Express has set `req.route` for any request that matched a route, guards
 * included. The label is that route pattern (`/images/:id`), never
 * the raw URL, which carries ids and tokens and would blow up cardinality.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (isSkipped(req.path)) return next();

    // Nest mounts this middleware as a catch-all route (`/{*splat}`), so
    // `req.route` is already that catch-all here — and stays so when no
    // controller matches. Remembered to tell the two apart on finish.
    // Express types `Request.route` as `any`; narrowed so the label is a string.
    const mountRoute = req.route as { path?: string } | undefined;
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const matched = req.route as { path?: string } | undefined;
      const route =
        (matched !== mountRoute ? matched?.path : undefined) ?? 'unmatched';
      this.metrics.httpRequestDuration.observe(
        { method: req.method, route, status: String(res.statusCode) },
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    });
    next();
  }
}
