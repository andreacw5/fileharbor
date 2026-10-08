import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  AdminStatsResponseDto,
  DailyDataPointDto,
  StatsTrendDto,
} from '@/modules/admin/dto/admin-response.dto';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { buildClientWhere } from '@/modules/admin/helpers/admin-access.helper';
import { APP_VERSION } from '@/common/version';

const DAY_MS = 24 * 60 * 60 * 1000;

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
      storageAgg,
      newImages,
      newAvatars,
      newAlbums,
      newVideos,
      newCreators,
      newStorageAgg,
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
      this.prisma.image.count({ where: clientWhere7d }),
      this.prisma.avatar.count({ where: clientWhere7d }),
      this.prisma.album.count({ where: clientWhere7d }),
      this.prisma.video.count({ where: clientWhere7d }),
      this.prisma.creator.count({ where: clientWhere7d }),
      this.prisma.image.aggregate({
        where: clientWhere7d,
        _sum: { size: true },
      }),
    ]);

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
        newStorage: newStorageAgg._sum.size || 0,
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
        totalStorage: storageAgg._sum.size || 0,
        last7Days,
        dailyChart,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Per-day counts for images, avatars, albums and videos over the 7 UTC days
   * starting at `from`, grouped in SQL so no rows leave the database.
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
        },
        { excludeExtraneousValues: true },
      );
    });
  }
}
