import { MediaKind } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';

export interface KindUsage {
  count: number;
  bytes: number;
}

export type ClientUsage = Record<'images' | 'videos' | 'avatars', KindUsage>;

export const KIND_FIELDS: Record<MediaKind, keyof ClientUsage> = {
  IMAGE: 'images',
  VIDEO: 'videos',
  AVATAR: 'avatars',
};

export const emptyUsage = (): ClientUsage => ({
  images: { count: 0, bytes: 0 },
  videos: { count: 0, bytes: 0 },
  avatars: { count: 0, bytes: 0 },
});

export const totalBytes = (u: ClientUsage) =>
  u.images.bytes + u.videos.bytes + u.avatars.bytes;

/**
 * Count and bytes per client and kind, from the live rows: what totalStorage,
 * the storage report and StorageSnapshotJob all read. Only clients with rows
 * are in the map. `clientIds` undefined = every client (the job only).
 * Video sizes are BigInt; a Number is exact up to 8 PiB.
 */
export async function storageUsageByClient(
  prisma: PrismaService,
  clientIds?: string[],
): Promise<Map<string, ClientUsage>> {
  const where = clientIds ? { clientId: { in: clientIds } } : undefined;
  const [images, videos, avatars] = await Promise.all([
    prisma.image.groupBy({
      by: ['clientId'],
      where,
      _count: { _all: true },
      _sum: { size: true },
    }),
    prisma.video.groupBy({
      by: ['clientId'],
      where,
      _count: { _all: true },
      _sum: { size: true },
    }),
    prisma.avatar.groupBy({
      by: ['clientId'],
      where,
      _count: { _all: true },
      _sum: { size: true },
    }),
  ]);

  const usage = new Map<string, ClientUsage>();
  const add = (kind: keyof ClientUsage, rows: unknown[]) => {
    for (const row of rows as {
      clientId: string;
      _count: { _all: number };
      _sum: { size: number | bigint | null };
    }[]) {
      const u = usage.get(row.clientId) ?? emptyUsage();
      u[kind] = { count: row._count._all, bytes: Number(row._sum.size ?? 0) };
      usage.set(row.clientId, u);
    }
  };
  add('images', images);
  add('videos', videos);
  add('avatars', avatars);
  return usage;
}
