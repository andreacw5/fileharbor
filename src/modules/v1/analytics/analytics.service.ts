import { Injectable, NotFoundException } from '@nestjs/common';
import { subDays } from 'date-fns';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDomainStatistics(domain: string, days = 30) {
    const since = subDays(new Date(), days);

    const owner = await this.prisma.owner.findFirst({
      where: { domain },
      select: {
        id: true,
        domain: true,
      },
    });

    if (!owner) {
      throw new NotFoundException(`Domain "${domain}" not found`);
    }

    const [avatars, files] = await Promise.all([
      this.prisma.avatar.findMany({
        where: {
          ownerId: owner.id,
          createdAt: { gte: since },
        },
      }),
      this.prisma.localFile.findMany({
        where: {
          ownerId: owner.id,
          createdAt: { gte: since },
        },
      }),
    ]);

    const avatarStats = this.computeStats(avatars, 'avatar');
    const fileStats = this.computeStats(files, 'file');

    return {
      domain: owner.domain,
      period: `${days} days`,
      totals: {
        avatars: avatarStats.totals,
        files: fileStats.totals,
      },
      uploadsPerDay: {
        avatars: avatarStats.trend,
        files: fileStats.trend,
      },
    };
  }

  private computeStats(items: any[], type: 'avatar' | 'file') {
    const isFile = type === 'file';
    const total = items.length;
    const totalViews = items.reduce((sum, i) => sum + (i.views || 0), 0);
    const totalDownloads = isFile
      ? items.reduce((sum, i) => sum + (i.downloads || 0), 0)
      : undefined;
    const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);
    const optimizedCount = items.filter((i) => i.optimized).length;
    const avgViews = total > 0 ? totalViews / total : 0;
    const percentOptimized = total > 0 ? (optimizedCount / total) * 100 : 0;

    const trend = items.reduce(
      (acc, i) => {
        const day = i.createdAt.toISOString().slice(0, 10);
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totals: {
        count: total,
        totalViews,
        avgViews,
        totalSizeBytes: totalSize,
        percentOptimized,
        ...(isFile && { totalDownloads }),
      },
      trend,
    };
  }
}
