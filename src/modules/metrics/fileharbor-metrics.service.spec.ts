import { Logger } from '@nestjs/common';
import { MetricsService } from '@heyatom/nest-common/metrics';
import { FileharborMetrics } from './fileharbor-metrics.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('FileharborMetrics optimize backlog gauges', () => {
  let service: FileharborMetrics;
  const model = () => ({
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  });
  const mockPrisma = { image: model(), avatar: model(), video: model() };

  /** One scrape of a gauge: value by `kind` label (or another one). */
  async function scrape(
    name: string,
    label = 'kind',
  ): Promise<Record<string, number>> {
    const { values } = await (
      service['metrics'].registry.getSingleMetric(name) as unknown as {
        get(): Promise<{
          values: Array<{ labels: Record<string, string>; value: number }>;
        }>;
      }
    ).get();
    return Object.fromEntries(values.map((v) => [v.labels[label], v.value]));
  }

  const gaugeValue = async (name: string, kind: string) =>
    (await scrape(name))[kind];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileharborMetrics(
      new MetricsService({ app: 'fileharbor' }),
      mockPrisma as unknown as PrismaService,
    );
  });

  it('runs no query before a scrape', () => {
    expect(mockPrisma.image.count).not.toHaveBeenCalled();
    expect(mockPrisma.image.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.avatar.count).not.toHaveBeenCalled();
    expect(mockPrisma.image.groupBy).not.toHaveBeenCalled();
  });

  it('fileharbor_unoptimized_media counts retryable rows for both kinds, with the job predicate', async () => {
    mockPrisma.image.count.mockResolvedValue(4);
    mockPrisma.avatar.count.mockResolvedValue(0);

    expect(await gaugeValue('fileharbor_unoptimized_media', 'image')).toBe(4);
    expect(await gaugeValue('fileharbor_unoptimized_media', 'avatar')).toBe(0);
    expect(mockPrisma.image.count).toHaveBeenCalledWith({
      where: { isOptimized: false, optimizeAttempts: { lt: 3 } },
    });
  });

  it('fileharbor_optimize_given_up counts rows past the attempt limit', async () => {
    mockPrisma.image.count.mockResolvedValue(2);
    mockPrisma.avatar.count.mockResolvedValue(1);

    expect(await gaugeValue('fileharbor_optimize_given_up', 'image')).toBe(2);
    expect(await gaugeValue('fileharbor_optimize_given_up', 'avatar')).toBe(1);
    expect(mockPrisma.avatar.count).toHaveBeenCalledWith({
      where: { isOptimized: false, optimizeAttempts: { gte: 3 } },
    });
  });

  it('fileharbor_unoptimized_oldest_age_seconds is the age of the oldest retryable row, 0 when empty', async () => {
    mockPrisma.image.aggregate.mockResolvedValue({
      _min: { createdAt: new Date(Date.now() - 10_000) },
    });
    mockPrisma.avatar.aggregate.mockResolvedValue({
      _min: { updatedAt: null },
    });

    const age = await gaugeValue(
      'fileharbor_unoptimized_oldest_age_seconds',
      'image',
    );
    expect(age).toBeGreaterThanOrEqual(9.5);
    expect(age).toBeLessThan(15);
    expect(
      await gaugeValue('fileharbor_unoptimized_oldest_age_seconds', 'avatar'),
    ).toBe(0);
    expect(mockPrisma.image.aggregate).toHaveBeenCalledWith({
      where: { isOptimized: false, optimizeAttempts: { lt: 3 } },
      _min: { createdAt: true },
    });
    // A re-uploaded avatar keeps its createdAt; updatedAt marks when it was queued.
    expect(mockPrisma.avatar.aggregate).toHaveBeenCalledWith({
      where: { isOptimized: false, optimizeAttempts: { lt: 3 } },
      _min: { updatedAt: true },
    });
  });

  it('a DB error keeps the previous value and warns instead of failing the scrape', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mockPrisma.image.count.mockResolvedValueOnce(7);
    mockPrisma.avatar.count.mockResolvedValueOnce(3);
    await gaugeValue('fileharbor_unoptimized_media', 'image');

    mockPrisma.image.count.mockRejectedValueOnce(new Error('db down'));
    mockPrisma.avatar.count.mockResolvedValueOnce(9);

    // One scrape: a second read would trigger another collect()
    expect(await scrape('fileharbor_unoptimized_media')).toEqual({
      image: 7,
      avatar: 3,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('fileharbor_unoptimized_media'),
    );
  });

  describe('fileharbor_storage_bytes', () => {
    const rows = (...r: [string, number | bigint][]) =>
      r.map(([clientId, size]) => ({
        clientId,
        _count: { _all: 1 },
        _sum: { size },
      }));

    beforeEach(() => {
      mockPrisma.image.groupBy.mockResolvedValue([]);
      mockPrisma.video.groupBy.mockResolvedValue([]);
      mockPrisma.avatar.groupBy.mockResolvedValue([]);
    });

    it('sums images, videos (BigInt) and avatars per client, over every client', async () => {
      mockPrisma.image.groupBy.mockResolvedValue(rows(['c1', 100], ['c2', 5]));
      mockPrisma.video.groupBy.mockResolvedValue(rows(['c1', BigInt(1000)]));
      mockPrisma.avatar.groupBy.mockResolvedValue(rows(['c1', 10]));

      expect(await scrape('fileharbor_storage_bytes', 'client')).toEqual({
        c1: 1110,
        c2: 5,
      });
      expect(mockPrisma.image.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('drops a client missing from the next scrape', async () => {
      mockPrisma.image.groupBy.mockResolvedValueOnce(
        rows(['c1', 1], ['c2', 2]),
      );
      await scrape('fileharbor_storage_bytes', 'client');

      mockPrisma.image.groupBy.mockResolvedValueOnce(rows(['c1', 3]));
      expect(await scrape('fileharbor_storage_bytes', 'client')).toEqual({
        c1: 3,
      });
    });

    it('a DB error keeps the previous values and warns', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockPrisma.image.groupBy.mockResolvedValueOnce(rows(['c1', 7]));
      await scrape('fileharbor_storage_bytes', 'client');

      mockPrisma.video.groupBy.mockRejectedValueOnce(new Error('db down'));
      expect(await scrape('fileharbor_storage_bytes', 'client')).toEqual({
        c1: 7,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fileharbor_storage_bytes'),
      );
    });
  });
});
