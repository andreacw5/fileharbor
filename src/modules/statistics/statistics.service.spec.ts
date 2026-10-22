import { StatisticsService } from './statistics.service';

describe('StatisticsService.getGlobalStats', () => {
  const admin = { allowedClientIds: ['client-1'] } as any;

  // Image and avatar sizes are Int, video sizes BigInt: totals must add all three.
  const sizes = { image: 1000, video: BigInt(3_000_000_000), avatar: 50 };
  const model = (size: number | bigint | null) => ({
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { size } }),
  });

  const build = (video: bigint | null) =>
    new StatisticsService({
      client: model(null),
      image: model(sizes.image),
      video: model(video),
      avatar: model(sizes.avatar),
      album: model(null),
      creator: model(null),
      storageSnapshot: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as any);

  it('sums image, video and avatar bytes into totalStorage and newStorage', async () => {
    const stats = await build(sizes.video).getGlobalStats(admin);

    expect(stats.totalStorage).toBe(3_000_001_050);
    expect(stats.last7Days.newStorage).toBe(3_000_001_050);
    // Plain numbers: a bigint here would make the JSON response throw
    expect(typeof stats.totalStorage).toBe('number');
    expect(stats.storageByKind).toEqual({
      images: 1000,
      videos: 3_000_000_000,
      avatars: 50,
    });
  });

  it('leaves dailyChart storage null on days with no snapshot', async () => {
    const stats = await build(sizes.video).getGlobalStats(admin);

    expect(stats.dailyChart).toHaveLength(7);
    expect(stats.dailyChart.every((d) => d.storage === null)).toBe(true);
  });

  it('treats an empty table (null sum) as zero bytes', async () => {
    const stats = await build(null).getGlobalStats(admin);

    expect(stats.totalStorage).toBe(1050);
  });
});

describe('StatisticsService storage report', () => {
  const admin = { allowedClientIds: ['c1', 'c2'] } as any;
  const day = (d: string) => new Date(`${d}T00:00:00Z`);

  const build = () => {
    const prisma = {
      storageSnapshot: {
        groupBy: jest.fn().mockResolvedValue([
          {
            day: day('2026-10-21'),
            kind: 'IMAGE',
            _sum: { bytes: BigInt(100) },
          },
          { day: day('2026-10-21'), kind: 'VIDEO', _sum: { bytes: BigInt(5) } },
        ]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _min: { day: day('2026-10-21') } }),
      },
      client: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', name: 'small' },
          { id: 'c2', name: 'big' },
        ]),
      },
      image: {
        groupBy: jest.fn().mockResolvedValue([
          { clientId: 'c2', _count: { _all: 2 }, _sum: { size: 900 } },
          { clientId: 'c1', _count: { _all: 1 }, _sum: { size: 10 } },
        ]),
      },
      video: { groupBy: jest.fn().mockResolvedValue([]) },
      avatar: { groupBy: jest.fn().mockResolvedValue([]) },
      creator: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ total: 0 }]),
    };
    return { prisma, service: new StatisticsService(prisma as any) };
  };

  it('has one point per day, null before the first snapshot, 0 for a missing kind', async () => {
    const { service } = build();
    const report = await service.getStorageReport(admin, {
      from: '2026-10-20',
      to: '2026-10-22',
    });

    expect(report.firstSnapshot).toBe('2026-10-21');
    expect(report.series).toEqual([
      { date: '2026-10-20', images: null, videos: null, avatars: null },
      { date: '2026-10-21', images: 100, videos: 5, avatars: 0 },
      { date: '2026-10-22', images: null, videos: null, avatars: null },
    ]);
    // byClient is live and biggest first; a client with no videos reads 0
    expect(report.byClient.map((c) => c.clientId)).toEqual(['c2', 'c1']);
    expect(report.byClient[0].videos).toEqual({ count: 0, bytes: 0 });
  });

  it('rejects a reversed, oversized or impossible range with 400', async () => {
    const { service } = build();
    for (const q of [
      { from: '2026-10-22', to: '2026-10-21' },
      { from: '2025-01-01', to: '2026-10-22' },
      { from: '2026-02-31', to: '2026-03-02' },
    ]) {
      await expect(service.getStorageReport(admin, q)).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it('refuses a clientId out of scope and reads only the scope', async () => {
    const { prisma, service } = build();
    await expect(
      service.getStorageReport(admin, { clientId: 'other' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.getCreatorStorage(admin, { clientId: 'other' } as any),
    ).rejects.toMatchObject({ status: 403 });

    await service.getStorageReport(admin, {});
    expect(
      prisma.storageSnapshot.groupBy.mock.calls[0][0].where.clientId,
    ).toEqual({
      in: ['c1', 'c2'],
    });
  });

  it('pages creators biggest first with their identity', async () => {
    const { prisma, service } = build();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          creatorId: 'k1',
          images: 10,
          videos: 0,
          avatars: 1,
          totalBytes: 11,
          itemCount: 2,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    prisma.creator.findMany.mockResolvedValue([
      { id: 'k1', externalId: 'ext-1', username: null, clientId: 'c1' },
    ]);

    const page = await service.getCreatorStorage(admin, {
      page: 1,
      limit: 20,
      skip: 0,
    } as any);

    expect(page.meta.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      externalId: 'ext-1',
      clientId: 'c1',
      totalBytes: 11,
    });
  });
});
