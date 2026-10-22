import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  AdminStatsResponseDto,
  DailyDataPointDto,
  StatsTrendDto,
} from '@/modules/admin/dto/admin-response.dto';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import { APP_VERSION } from '@/common/version';
import { paginate, PaginatedResult } from '@heyatom/nest-common';
import {
  CreatorStorageDto,
  CreatorStorageQuery,
  StorageReportDto,
  StorageReportQuery,
} from './dto/storage-report.dto';
import {
  emptyUsage,
  KIND_FIELDS,
  storageUsageByClient,
  totalBytes,
} from './storage-usage';
import { utcDay } from './storage-snapshot.job';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 366;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalStats(admin: AdminJwtPayload): Promise<AdminStatsResponseDto> {
    const clientWhere = buildClientWhere(admin);

    // UTC midnight six days ago: the window is the last 7 UTC days, today included
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);
    sevenDaysAgo.setTime(sevenDaysAgo.getTime() - 6 * DAY_MS);

    const clientWhere7d = { ...clientWhere, createdAt: { gte: sevenDaysAgo } };

    const [
      totalClients,
      totalImages,
      totalAvatars,
      totalAlbums,
      totalVideos,
      totalCreators,
      imageStorageAgg,
      videoStorageAgg,
      avatarStorageAgg,
      newImages,
      newAvatars,
      newAlbums,
      newVideos,
      newCreators,
      newImageStorageAgg,
      newVideoStorageAgg,
      newAvatarStorageAgg,
    ] = await Promise.all([
      this.prisma.client.count(
        Object.keys(clientWhere).length
          ? { where: { id: (clientWhere as any).clientId } }
          : undefined,
      ),
      this.prisma.image.count({ where: clientWhere }),
      this.prisma.avatar.count({ where: clientWhere }),
      this.prisma.album.count({ where: clientWhere }),
      this.prisma.video.count({ where: clientWhere }),
      this.prisma.creator.count({ where: clientWhere }),
      this.prisma.image.aggregate({ where: clientWhere, _sum: { size: true } }),
      this.prisma.video.aggregate({ where: clientWhere, _sum: { size: true } }),
      this.prisma.avatar.aggregate({
        where: clientWhere,
        _sum: { size: true },
      }),
      this.prisma.image.count({ where: clientWhere7d }),
      this.prisma.avatar.count({ where: clientWhere7d }),
      this.prisma.album.count({ where: clientWhere7d }),
      this.prisma.video.count({ where: clientWhere7d }),
      this.prisma.creator.count({ where: clientWhere7d }),
      this.prisma.image.aggregate({
        where: clientWhere7d,
        _sum: { size: true },
      }),
      this.prisma.video.aggregate({
        where: clientWhere7d,
        _sum: { size: true },
      }),
      this.prisma.avatar.aggregate({
        where: clientWhere7d,
        _sum: { size: true },
      }),
    ]);

    // Video sizes are BigInt; a Number is exact up to 8 PiB.
    const sumBytes = (...aggs: { _sum: { size: number | bigint | null } }[]) =>
      aggs.reduce((total, agg) => total + Number(agg._sum.size ?? 0), 0);

    const dailyChart = await this.buildDailyChart(
      admin.allowedClientIds,
      sevenDaysAgo,
    );

    const last7Days = plainToInstance(
      StatsTrendDto,
      {
        newImages,
        newAvatars,
        newAlbums,
        newVideos,
        newCreators,
        newStorage: sumBytes(
          newImageStorageAgg,
          newVideoStorageAgg,
          newAvatarStorageAgg,
        ),
      },
      { excludeExtraneousValues: true },
    );

    return plainToInstance(
      AdminStatsResponseDto,
      {
        version: APP_VERSION,
        totalClients,
        totalImages,
        totalAvatars,
        totalAlbums,
        totalVideos,
        totalCreators,
        totalStorage: sumBytes(
          imageStorageAgg,
          videoStorageAgg,
          avatarStorageAgg,
        ),
        storageByKind: {
          images: sumBytes(imageStorageAgg),
          videos: sumBytes(videoStorageAgg),
          avatars: sumBytes(avatarStorageAgg),
        },
        last7Days,
        dailyChart,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Per-day counts for images, avatars, albums and videos over the 7 UTC days
   * starting at `from`, grouped in SQL so no rows leave the database, plus that
   * day's snapshotted bytes (null on a day with no snapshot).
   */
  private async buildDailyChart(
    clientIds: string[],
    from: Date,
  ): Promise<DailyDataPointDto[]> {
    const to = new Date(from.getTime() + 7 * DAY_MS);
    const range = Prisma.sql`"clientId" = ANY(${clientIds}::text[]) AND "createdAt" >= ${from} AND "createdAt" < ${to}`;

    // createdAt is timestamp without time zone holding UTC, so date_trunc buckets by UTC day
    const rows = await this.prisma.$queryRaw<
      { kind: string; day: string; count: number }[]
    >`
      SELECT kind, to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*)::int AS count
      FROM (
        SELECT 'images' AS kind, "createdAt" FROM images WHERE ${range}
        UNION ALL SELECT 'avatars', "createdAt" FROM avatars WHERE ${range}
        UNION ALL SELECT 'albums', "createdAt" FROM albums WHERE ${range}
        UNION ALL SELECT 'videos', "createdAt" FROM videos WHERE ${range}
      ) t
      GROUP BY 1, 2`;

    const snapshots = await this.prisma.storageSnapshot.groupBy({
      by: ['day'],
      where: { clientId: { in: clientIds }, day: { gte: from, lt: to } },
      _sum: { bytes: true },
    });
    const storage = new Map(
      snapshots.map((s) => [isoDay(s.day), Number(s._sum.bytes ?? 0)]),
    );

    const counts = new Map(rows.map((r) => [`${r.kind}:${r.day}`, r.count]));
    const at = (kind: string, date: string) =>
      counts.get(`${kind}:${date}`) ?? 0;

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(from.getTime() + i * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return plainToInstance(
        DailyDataPointDto,
        {
          date,
          images: at('images', date),
          avatars: at('avatars', date),
          albums: at('albums', date),
          videos: at('videos', date),
          storage: storage.get(date) ?? null,
        },
        { excludeExtraneousValues: true },
      );
    });
  }

  /**
   * Storage per day and kind from the snapshots (summed over the clients in
   * scope), plus the live split per client.
   */
  async getStorageReport(
    admin: AdminJwtPayload,
    query: StorageReportQuery,
  ): Promise<StorageReportDto> {
    const to = query.to ? parseDay('to', query.to) : utcDay();
    const from = query.from
      ? parseDay('from', query.from)
      : new Date(to.getTime() - 29 * DAY_MS);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days < 1 || days > MAX_REPORT_DAYS) {
      throw new BadRequestException([
        `to must be on or after from, at most ${MAX_REPORT_DAYS} days`,
      ]);
    }

    if (query.clientId) assertClientAccess(admin, query.clientId);
    const clientIds = query.clientId
      ? [query.clientId]
      : admin.allowedClientIds;
    const inScope = { clientId: { in: clientIds } };

    const [snapshots, first, clients, usage] = await Promise.all([
      this.prisma.storageSnapshot.groupBy({
        by: ['day', 'kind'],
        where: { ...inScope, day: { gte: from, lte: to } },
        _sum: { bytes: true },
      }),
      this.prisma.storageSnapshot.aggregate({
        where: inScope,
        _min: { day: true },
      }),
      this.prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      }),
      storageUsageByClient(this.prisma, clientIds),
    ]);

    const bytes = new Map(
      snapshots.map((s) => [
        `${isoDay(s.day)}:${KIND_FIELDS[s.kind]}`,
        Number(s._sum.bytes ?? 0),
      ]),
    );
    const series = Array.from({ length: days }, (_, i) => {
      const date = isoDay(new Date(from.getTime() + i * DAY_MS));
      // A day with any snapshot row counts its missing kinds as 0, one with none is null
      const taken = ['images', 'videos', 'avatars'].some((k) =>
        bytes.has(`${date}:${k}`),
      );
      const at = (k: string) =>
        taken ? (bytes.get(`${date}:${k}`) ?? 0) : null;
      return {
        date,
        images: at('images'),
        videos: at('videos'),
        avatars: at('avatars'),
      };
    });

    const byClient = clients
      .map((c) => ({
        clientId: c.id,
        name: c.name,
        ...(usage.get(c.id) ?? emptyUsage()),
      }))
      .sort((a, b) => totalBytes(b) - totalBytes(a));

    return {
      from: isoDay(from),
      to: isoDay(to),
      firstSnapshot: first._min.day ? isoDay(first._min.day) : null,
      series,
      byClient,
    };
  }

  /** Live bytes per creator over images, videos and avatars, biggest first. */
  async getCreatorStorage(
    admin: AdminJwtPayload,
    query: CreatorStorageQuery,
  ): Promise<PaginatedResult<CreatorStorageDto>> {
    if (query.clientId) assertClientAccess(admin, query.clientId);
    const clientIds = query.clientId
      ? [query.clientId]
      : admin.allowedClientIds;
    const scope = Prisma.sql`"clientId" = ANY(${clientIds}::text[])`;
    const media = Prisma.sql`
      SELECT "creatorId", 'images' AS kind, size::bigint AS size FROM images WHERE ${scope}
      UNION ALL SELECT "creatorId", 'videos', size FROM videos WHERE ${scope}
      UNION ALL SELECT "creatorId", 'avatars', size::bigint FROM avatars WHERE ${scope}`;
    const byKind = (kind: string) =>
      Prisma.sql`coalesce(sum(size) FILTER (WHERE kind = ${kind}), 0)::float8`;

    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<
        {
          creatorId: string;
          images: number;
          videos: number;
          avatars: number;
          totalBytes: number;
          itemCount: number;
        }[]
      >`SELECT "creatorId", ${byKind('images')} AS images, ${byKind('videos')} AS videos,
          ${byKind('avatars')} AS avatars, sum(size)::float8 AS "totalBytes", count(*)::int AS "itemCount"
        FROM (${media}) t
        GROUP BY "creatorId"
        ORDER BY "totalBytes" DESC, "creatorId"
        LIMIT ${query.limit} OFFSET ${query.skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(DISTINCT "creatorId")::int AS total FROM (${media}) t`,
    ]);

    const creators = rows.length
      ? await this.prisma.creator.findMany({
          where: { id: { in: rows.map((r) => r.creatorId) } },
          select: {
            id: true,
            externalId: true,
            username: true,
            clientId: true,
          },
        })
      : [];
    const byId = new Map(creators.map((c) => [c.id, c]));

    return paginate(
      rows.map((r) => {
        const c = byId.get(r.creatorId);
        return {
          ...r,
          externalId: c?.externalId ?? '',
          username: c?.username ?? null,
          clientId: c?.clientId ?? '',
        };
      }),
      total,
      query,
    );
  }
}

/** `YYYY-MM-DD` (shape checked by the DTO) as UTC midnight; 2026-02-31 is a 400. */
function parseDay(field: string, value: string): Date {
  const day = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || isoDay(day) !== value) {
    throw new BadRequestException([`${field} must be a valid date`]);
  }
  return day;
}
