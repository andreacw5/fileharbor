import { StorageSnapshotJob, utcDay } from './storage-snapshot.job';

describe('StorageSnapshotJob.writeSnapshot', () => {
  const build = () => {
    const prisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'empty' }]),
      },
      image: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { clientId: 'c1', _count: { _all: 2 }, _sum: { size: 300 } },
          ]),
      },
      video: { groupBy: jest.fn().mockResolvedValue([]) },
      avatar: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { clientId: 'c1', _count: { _all: 1 }, _sum: { size: 7 } },
          ]),
      },
      storageSnapshot: { upsert: jest.fn((args) => args) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { prisma, job: new StorageSnapshotJob(prisma as any) };
  };

  it('writes every client x kind for today, zeros included, as upserts on (day, client, kind)', async () => {
    const { prisma, job } = build();

    expect(await job.writeSnapshot()).toBe(6);

    const rows = prisma.$transaction.mock.calls[0][0];
    const day = utcDay();
    expect(rows).toContainEqual({
      where: { day_clientId_kind: { day, clientId: 'c1', kind: 'IMAGE' } },
      create: {
        day,
        clientId: 'c1',
        kind: 'IMAGE',
        count: 2,
        bytes: BigInt(300),
      },
      update: { count: 2, bytes: BigInt(300) },
    });
    // c1 has no videos and 'empty' has nothing: rows at 0, no holes in the series
    expect(rows).toContainEqual(
      expect.objectContaining({
        create: {
          day,
          clientId: 'c1',
          kind: 'VIDEO',
          count: 0,
          bytes: BigInt(0),
        },
      }),
    );
    expect(
      rows.filter((r) => r.create.clientId === 'empty' && r.create.count === 0),
    ).toHaveLength(3);
  });

  it('a second run the same day targets the same keys (idempotent)', async () => {
    const { prisma, job } = build();
    await job.writeSnapshot();
    await job.writeSnapshot();

    const keys = (call: number) =>
      prisma.$transaction.mock.calls[call][0].map((r) => r.where);
    expect(keys(1)).toEqual(keys(0));
  });
});

describe('utcDay', () => {
  it('is UTC midnight of the instant', () => {
    expect(utcDay(new Date('2026-10-22T23:59:00+02:00')).toISOString()).toBe(
      '2026-10-22T00:00:00.000Z',
    );
  });
});
