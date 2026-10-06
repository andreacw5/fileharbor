import { Logger } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('MetricsService optimize backlog gauges', () => {
  let service: MetricsService;
  const model = () => ({ count: jest.fn(), aggregate: jest.fn() });
  const mockPrisma = { image: model(), avatar: model() };

  /** One scrape of a gauge: value by `kind` label. */
  async function scrape(name: string): Promise<Record<string, number>> {
    const { values } = await (
      service.registry.getSingleMetric(name) as unknown as {
        get(): Promise<{
          values: Array<{ labels: Record<string, string>; value: number }>;
        }>;
      }
    ).get();
    return Object.fromEntries(values.map((v) => [v.labels.kind, v.value]));
  }

  const gaugeValue = async (name: string, kind: string) =>
    (await scrape(name))[kind];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MetricsService(mockPrisma as unknown as PrismaService);
  });

  it('runs no query before a scrape', () => {
    expect(mockPrisma.image.count).not.toHaveBeenCalled();
    expect(mockPrisma.image.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.avatar.count).not.toHaveBeenCalled();
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
});
