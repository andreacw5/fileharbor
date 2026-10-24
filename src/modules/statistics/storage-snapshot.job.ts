import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MediaKind } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { emptyUsage, KIND_FIELDS, storageUsageByClient } from './storage-usage';

/** UTC midnight of `at`: the `day` a snapshot taken at `at` is stored under. */
export function utcDay(at = new Date()): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

@Injectable()
export class StorageSnapshotJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageSnapshotJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Day 0 after a deploy, and any day the 00:30 run missed: never blocks boot. */
  onApplicationBootstrap() {
    this.prisma.storageSnapshot
      .count({ where: { day: utcDay() } })
      .then((n) => (n ? undefined : this.snapshotStorage()))
      .catch((error) =>
        this.logger.warn(`Boot storage snapshot failed: ${error.message}`),
      );
  }

  @Cron('30 0 * * *', { timeZone: 'UTC' })
  async snapshotStorage() {
    await this.prisma.runExclusive('stats.storage_snapshot', async () => {
      try {
        const written = await this.writeSnapshot();
        this.logger.log(`Storage snapshot: ${written} rows`);
      } catch (error) {
        this.logger.error('Storage snapshot job failed', error.stack);
      }
    });
  }

  /**
   * One row per client and kind for today, zeros included so the series has no
   * holes. Upserts: a second run the same day overwrites, never duplicates.
   */
  async writeSnapshot(): Promise<number> {
    const day = utcDay();
    const [clients, usage] = await Promise.all([
      this.prisma.client.findMany({ select: { id: true } }),
      storageUsageByClient(this.prisma),
    ]);

    const upserts = clients.flatMap(({ id: clientId }) => {
      const u = usage.get(clientId) ?? emptyUsage();
      return (Object.keys(KIND_FIELDS) as MediaKind[]).map((kind) => {
        const { count, bytes } = u[KIND_FIELDS[kind]];
        const values = { count, bytes: BigInt(bytes) };
        return this.prisma.storageSnapshot.upsert({
          where: { day_clientId_kind: { day, clientId, kind } },
          create: { day, clientId, kind, ...values },
          update: values,
        });
      });
    });
    await this.prisma.$transaction(upserts);
    return upserts.length;
  }
}
