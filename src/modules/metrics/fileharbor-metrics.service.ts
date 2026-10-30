import { Injectable, Logger } from '@nestjs/common';
import { Counter, Gauge } from '@prometheus-io/client';
import { MetricsService } from '@heyatom/nest-common/metrics';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  OPTIMIZE_GIVEN_UP_WHERE,
  OPTIMIZE_RETRYABLE_WHERE,
} from '@/modules/storage/storage.service';
import {
  storageUsageByClient,
  totalBytes,
} from '@/modules/statistics/storage-usage';

/** How long a `fileharbor_storage_bytes` collection is reused across scrapes. */
export const STORAGE_GAUGE_MEMO_MS = 60_000;

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
 * fileharbor's domain metrics, on the registry of nest-common's `MetricsService`
 * (which owns `app="fileharbor"`, the default metrics, the HTTP histogram and the
 * `/metrics` server on METRICS_PORT).
 *
 * The optimize backlog and storage gauges are computed lazily in `collect()`:
 * no query runs until something scrapes. A failed query logs a warning and leaves the
 * gauge at its previous value instead of failing the whole scrape.
 */
@Injectable()
export class FileharborMetrics {
  private readonly logger = new Logger(FileharborMetrics.name);
  readonly videoProcessingFailures: Counter<'stage'>;
  readonly tinifyAuto: Counter<'result'>;

  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    // Video uploads swallow ffmpeg/ffprobe failures and still return 2xx, so
    // HTTP metrics stay green while every video lands without a thumbnail or
    // with duration/width/height = 0. This counter is the only signal.
    this.videoProcessingFailures = new Counter({
      name: 'fileharbor_video_processing_failures_total',
      help: 'Video uploads whose thumbnail or metadata extraction failed',
      labelNames: ['stage'],
      registers: [this.metrics.registry],
    });
    // Pre-initialized so increase() sees the very first failure.
    for (const stage of ['thumbnail', 'metadata']) {
      this.videoProcessingFailures.inc({ stage }, 0);
    }

    // TinifyAutoJob outcomes. A day of `failed` with no `compressed` means a broken key.
    this.tinifyAuto = new Counter({
      name: 'fileharbor_tinify_auto_total',
      help: 'Images handled by the Tinify auto-compress job, by result',
      labelNames: ['result'],
      registers: [this.metrics.registry],
    });
    for (const result of ['compressed', 'skipped', 'failed']) {
      this.tinifyAuto.inc({ result }, 0);
    }

    this.registerOptimizeGauges();
    this.registerStorageGauge();
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
      registers: [this.metrics.registry],
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
      'Unoptimized images/avatars the optimize job stopped retrying (MAX_OPTIMIZE_ATTEMPTS reached) — reset via POST admin/{images,avatars}/:id/reoptimize',
      (kind) => this.delegate(kind).count({ where: OPTIMIZE_GIVEN_UP_WHERE }),
    );
  }

  // Label = Client.id: immutable, unlike domain/name. Same bytes as the
  // console's totalStorage (originals only), so it says who grows, not how
  // much disk is left. Reset after the query, so clients deleted since the last
  // scrape drop out, and a failed query keeps the previous values.
  private registerStorageGauge(): void {
    const name = 'fileharbor_storage_bytes';
    // Three sum(size) sequential scans per scrape: at a 15s interval that is a
    // full pass over images every 15s. Storage moves slowly; 60s is plenty.
    let computedAt = 0;
    const gauge = new Gauge({
      name,
      help: 'Bytes of stored originals (images + videos + avatars) per client; excludes thumbnails and cached variants',
      labelNames: ['client'],
      registers: [this.metrics.registry],
      collect: async () => {
        if (Date.now() - computedAt < STORAGE_GAUGE_MEMO_MS) return;
        try {
          const usage = await storageUsageByClient(this.prisma);
          gauge.reset();
          for (const [client, u] of usage) gauge.set({ client }, totalBytes(u));
          computedAt = Date.now();
        } catch (err) {
          this.logger.warn(
            `${name} collection failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });
  }
}
