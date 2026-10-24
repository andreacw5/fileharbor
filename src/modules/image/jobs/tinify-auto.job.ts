import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import {
  ImageService,
  TINIFY_LIMIT_REACHED,
} from '@/modules/image/image.service';
import {
  MAX_OPTIMIZE_ATTEMPTS,
  StorageService,
} from '@/modules/storage/storage.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { FileharborMetrics } from '@/modules/metrics/fileharbor-metrics.service';

type AutoClient = {
  id: string;
  domain: string | null;
  tinifyAutoMinBytes: number | null;
  currentTinifyUsage: number;
  currentTinifyLimit: number;
};

/**
 * Compresses large images with Tinify for the clients that opted in
 * (`tinifyAutoMinBytes` set). Goes through `compressImageWithTinify`, so the
 * quota, checks and webhook are the manual endpoint's.
 */
@Injectable()
export class TinifyAutoJob {
  private readonly logger = new Logger(TinifyAutoJob.name);
  private readonly batch: number;

  constructor(
    private imageService: ImageService,
    private storage: StorageService,
    private prisma: PrismaService,
    private config: ConfigService,
    private metrics: FileharborMetrics,
  ) {
    // Per client per run: without a cap, 24 runs a day would spend the month's quota in hours
    this.batch = Number(this.config.get('TINIFY_AUTO_BATCH') ?? 20);
  }

  /**
   * Every hour at :30, out of step with the optimize job (:00)
   */
  @Cron('30 * * * *')
  async compressLargeImages() {
    await this.prisma.runExclusive('image.tinify_auto', async () => {
      try {
        const clients = await this.prisma.client.findMany({
          where: {
            tinifyActive: true,
            tinifyAutoMinBytes: { not: null },
            tinifyApiKey: { not: null },
            currentTinifyUsage: {
              lt: this.prisma.client.fields.currentTinifyLimit,
            },
          },
          select: {
            id: true,
            domain: true,
            tinifyApiKey: true,
            tinifyAutoMinBytes: true,
            currentTinifyUsage: true,
            currentTinifyLimit: true,
          },
        });

        for (const client of clients) {
          if (!client.tinifyApiKey?.trim()) continue;
          await this.compressClient(client);
        }
      } catch (error) {
        this.logger.error('Tinify auto-compress job failed:', error.message);
      }
    });
  }

  private async compressClient(client: AutoClient) {
    const minBytes = client.tinifyAutoMinBytes!;
    // Only sizes the query: the reservation in compressImageWithTinify is the real check
    const budget = Math.min(
      this.batch,
      client.currentTinifyLimit - client.currentTinifyUsage,
    );
    // Optimized only: the optimize job would re-encode a Tinify output and undo it
    const images = await this.prisma.image.findMany({
      where: {
        clientId: client.id,
        isOptimized: true,
        tinifyOptimized: false,
        tinifyAttempts: { lt: MAX_OPTIMIZE_ATTEMPTS },
        size: { gt: minBytes },
      },
      orderBy: { size: 'desc' },
      take: budget,
      select: { id: true },
    });
    if (images.length === 0) return;

    const domain = client.domain || client.id;
    let compressed = 0;
    let skipped = 0;
    let failed = 0;

    for (const { id } of images) {
      try {
        // A stale `size` (optimized before sizes were kept in sync) must not spend quota
        const { length } = await this.storage.readFile(
          this.storage.getImageFilePath(domain, id, 'original'),
        );
        if (length <= minBytes) {
          await this.prisma.image.updateMany({
            where: { id },
            data: { size: length },
          });
          skipped++;
          this.metrics.tinifyAuto.inc({ result: 'skipped' });
          continue;
        }

        await this.imageService.compressImageWithTinify(id);
        compressed++;
        this.metrics.tinifyAuto.inc({ result: 'compressed' });
      } catch (error) {
        if (this.stopsClient(error)) {
          // The rest would fail the same way and burn their attempts
          this.logger.warn(
            `Tinify auto-compress stopped for client ${client.id}: ${error.message}`,
          );
          break;
        }
        failed++;
        this.metrics.tinifyAuto.inc({ result: 'failed' });
        // updateMany: the row may have been deleted mid-run
        await this.prisma.image.updateMany({
          where: { id },
          data: { tinifyAttempts: { increment: 1 } },
        });
        this.logger.warn(
          `Tinify auto-compress failed for image ${id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Tinify auto-compress client ${client.id}: ${compressed} compressed, ${skipped} skipped, ${failed} failed`,
    );
  }

  /** Bad key, account out of compressions, or our monthly limit reached. */
  private stopsClient(error: any): boolean {
    const status = error.response?.status;
    if (status === 401 || status === 429) return true;
    return (
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === TINIFY_LIMIT_REACHED
    );
  }
}
