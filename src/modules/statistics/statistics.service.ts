import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  AdminStatsResponseDto,
  DailyDataPointDto,
  StatsTrendDto,
} from '@/modules/admin/dto/admin-response.dto';
import { AdminJwtPayload } from '@/modules/admin/guards/admin-jwt.guard';
import { buildClientWhere } from '@/modules/admin/helpers/admin-access.helper';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobalStats(admin: AdminJwtPayload): Promise<AdminStatsResponseDto> {
    const clientWhere = buildClientWhere(admin);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const clientWhere7d = { ...clientWhere, createdAt: { gte: sevenDaysAgo } };

    const [
      totalClients,
      totalImages,
      totalAvatars,
      totalAlbums,
      totalUsers,
      storageAgg,
      newImages,
      newAvatars,
      newAlbums,
      newUsers,
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
      this.prisma.user.count({ where: clientWhere }),
      this.prisma.image.aggregate({ where: clientWhere, _sum: { size: true } }),
      this.prisma.image.count({ where: clientWhere7d }),
      this.prisma.avatar.count({ where: clientWhere7d }),
      this.prisma.album.count({ where: clientWhere7d }),
      this.prisma.user.count({ where: clientWhere7d }),
      this.prisma.image.aggregate({ where: clientWhere7d, _sum: { size: true } }),
    ]);

    const dailyChart = await this.buildDailyChart(clientWhere, sevenDaysAgo);

    const last7Days = plainToInstance(
      StatsTrendDto,
      { newImages, newAvatars, newAlbums, newUsers, newStorage: newStorageAgg._sum.size || 0 },
      { excludeExtraneousValues: true },
    );

    return plainToInstance(
      AdminStatsResponseDto,
      {
        totalClients,
        totalImages,
        totalAvatars,
        totalAlbums,
        totalUsers,
        totalStorage: storageAgg._sum.size || 0,
        last7Days,
        dailyChart,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Build per-day counts for images, avatars, albums and users
   * for the 7-day window starting at `from`.
   */
  private async buildDailyChart(
    clientWhere: object,
    from: Date,
  ): Promise<DailyDataPointDto[]> {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }

    const to = new Date(from);
    to.setDate(to.getDate() + 7);

    const timeWhere = { ...clientWhere, createdAt: { gte: from, lt: to } };

    const [images, avatars, albums] = await Promise.all([
      this.prisma.image.findMany({ where: timeWhere, select: { createdAt: true } }),
      this.prisma.avatar.findMany({ where: timeWhere, select: { createdAt: true } }),
      this.prisma.album.findMany({ where: timeWhere, select: { createdAt: true } }),
    ]);

    const countByDay = (records: { createdAt: Date }[], date: string) =>
      records.filter((r) => r.createdAt.toISOString().slice(0, 10) === date).length;

    return days.map((date) =>
      plainToInstance(
        DailyDataPointDto,
        {
          date,
          images: countByDay(images, date),
          avatars: countByDay(avatars, date),
          albums: countByDay(albums, date),
        },
        { excludeExtraneousValues: true },
      ),
    );
  }
}

