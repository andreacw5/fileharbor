import { Injectable, Logger } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  OPTIMIZE_GIVEN_UP_WHERE,
  OPTIMIZE_RETRYABLE_WHERE,
} from '@/modules/storage/storage.service';

const MEDIA_KINDS = ['image', 'avatar'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

// The two delegates share these call shapes; the union of their real types
// isn't callable, hence the narrow structural type.
type OptimizeQueueDelegate = {
  count(args: { where: object }): Promise<number>;
  aggregate(args: {
    where: object;
    _min: Partial<Record<AgeField, true>>;
  }): Promise<{ _min: Partial<Record<AgeField, Date | null>> }>;
};

// When a row entered the optimize queue. An avatar re-upload is an upsert that
// keeps the original createdAt but resets isOptimized, so createdAt would read
// as hours/days old the moment a long-standing creator replaces their avatar;
// updatedAt is stamped by that upsert. Images are never replaced in place, and
// their updatedAt moves on metadata edits, so they keep createdAt.
type AgeField = 'createdAt' | 'updatedAt';
const QUEUED_AT: Record<MediaKind, AgeField> = {
  image: 'createdAt',
  avatar: 'updatedAt',
};

/**
 * Prometheus metrics for fileharbor. Uses its own `Registry` rather than the
 * @prometheus-io/client global one, so a `MetricsService` created per test (or per
 * NestJS TestingModule) never collides with metrics registered by another
 * test in the same process.
 *
 * The optimize backlog gauges are computed lazily in `collect()`: no query
 * runs until something scrapes. A failed query logs a warning and leaves the
 * gauge at its previous value instead of failing the whole scrape.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;
  readonly videoProcessingFailures: Counter<'stage'>;

  constructor(private readonly prisma: PrismaService) {
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

    // Video uploads swallow ffmpeg/ffprobe failures and still return 2xx, so
    // HTTP metrics stay green while every video lands without a thumbnail or
    // with duration/width/height = 0. This counter is the only signal.
    this.videoProcessingFailures = new Counter({
      name: 'fileharbor_video_processing_failures_total',
      help: 'Video uploads whose thumbnail or metadata extraction failed',
      labelNames: ['stage'],
      registers: [this.registry],
    });
    // Pre-initialized so increase() sees the very first failure.
    for (const stage of ['thumbnail', 'metadata']) {
      this.videoProcessingFailures.inc({ stage }, 0);
    }

    this.registerOptimizeGauges();
  }

  private delegate(kind: MediaKind): OptimizeQueueDelegate {
    return this.prisma[kind] as unknown as OptimizeQueueDelegate;
  }

  /** One gauge per metric, `kind` label always set for both kinds. */
  private lazyGauge(
    name: string,
    help: string,
    read: (kind: MediaKind) => Promise<number>,
  ): void {
    const gauge = new Gauge({
      name,
      help,
      labelNames: ['kind'],
      registers: [this.registry],
      collect: async () => {
        try {
          const values = await Promise.all(MEDIA_KINDS.map(read));
          MEDIA_KINDS.forEach((kind, i) => gauge.set({ kind }, values[i]));
        } catch (err) {
          this.logger.warn(
            `${name} collection failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
  }

  // Same predicates as the hourly optimize jobs (storage.service.ts), so a row
  // the job gave up on leaves the backlog gauges and shows in given_up instead.
  private registerOptimizeGauges(): void {
    this.lazyGauge(
      'fileharbor_unoptimized_media',
      'Unoptimized images/avatars the hourly optimize job will still retry',
      (kind) => this.delegate(kind).count({ where: OPTIMIZE_RETRYABLE_WHERE }),
    );

    this.lazyGauge(
      'fileharbor_unoptimized_oldest_age_seconds',
      'Age of the oldest retryable unoptimized image/avatar, 0 when there is none',
      async (kind) => {
        const field = QUEUED_AT[kind];
        const { _min } = await this.delegate(kind).aggregate({
          where: OPTIMIZE_RETRYABLE_WHERE,
          _min: { [field]: true },
        });
        const oldest = _min[field];
        return oldest ? (Date.now() - oldest.getTime()) / 1000 : 0;
      },
    );

    this.lazyGauge(
      'fileharbor_optimize_given_up',
      'Unoptimized images/avatars the optimize job stopped retrying (MAX_OPTIMIZE_ATTEMPTS reached) — need a manual optimizeAttempts reset',
      (kind) => this.delegate(kind).count({ where: OPTIMIZE_GIVEN_UP_WHERE }),
    );
  }
}
