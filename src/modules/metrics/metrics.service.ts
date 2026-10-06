import { Injectable } from '@nestjs/common';
import { Registry, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics for fileharbor. Uses its own `Registry` rather than the
 * prom-client global one, so a `MetricsService` created per test (or per
 * NestJS TestingModule) never collides with metrics registered by another
 * test in the same process.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;

  constructor() {
    // Kept from the previous @willsoto/nestjs-prometheus setup, so existing
    // dashboards and queries filtering on `app="fileharbor"` still match.
    this.registry.setDefaultLabels({ app: 'fileharbor' });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }
}
