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
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as any);

  it('sums image, video and avatar bytes into totalStorage and newStorage', async () => {
    const stats = await build(sizes.video).getGlobalStats(admin);

    expect(stats.totalStorage).toBe(3_000_001_050);
    expect(stats.last7Days.newStorage).toBe(3_000_001_050);
    // Plain numbers: a bigint here would make the JSON response throw
    expect(typeof stats.totalStorage).toBe('number');
  });

  it('treats an empty table (null sum) as zero bytes', async () => {
    const stats = await build(null).getGlobalStats(admin);

    expect(stats.totalStorage).toBe(1050);
  });
});
