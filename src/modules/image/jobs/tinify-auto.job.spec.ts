import { BadRequestException } from '@nestjs/common';
import { TinifyAutoJob } from './tinify-auto.job';
import { TINIFY_LIMIT_REACHED } from '@/modules/image/image.service';

const client = {
  id: 'c1',
  domain: 'example.com',
  tinifyApiKey: 'key',
  tinifyAutoMinBytes: 1000,
  currentTinifyUsage: 0,
  currentTinifyLimit: 500,
};

const tinifyError = (status: number) =>
  Object.assign(new Error(`Tinify ${status}`), { response: { status } });

function setup({
  clients = [client],
  images = [{ id: 'a' }, { id: 'b' }],
  fileSize = 5000,
  batch = '20',
}: {
  clients?: object[];
  images?: { id: string }[];
  fileSize?: number;
  batch?: string;
} = {}) {
  const imageService = {
    compressImageWithTinify: jest.fn().mockResolvedValue({}),
  };
  const storage = {
    getImageFilePath: jest.fn((_d, id) => id),
    readFile: jest.fn().mockResolvedValue(Buffer.alloc(fileSize)),
  };
  const prisma = {
    client: {
      findMany: jest.fn().mockResolvedValue(clients),
      fields: { currentTinifyLimit: 'limit-ref' },
    },
    image: {
      findMany: jest.fn().mockResolvedValue(images),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    runExclusive: (_job: string, fn: () => Promise<unknown>) => fn(),
  };
  const metrics = { tinifyAuto: { inc: jest.fn() } };
  const job = new TinifyAutoJob(
    imageService as any,
    storage as any,
    prisma as any,
    {
      get: jest.fn((key) => (key === 'TINIFY_AUTO_BATCH' ? batch : undefined)),
    } as any,
    metrics as any,
  );
  return { job, imageService, storage, prisma, metrics };
}

describe('TinifyAutoJob.compressLargeImages', () => {
  it('only picks clients that opted in with a threshold and have quota left', async () => {
    const { job, prisma } = setup();

    await job.compressLargeImages();

    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tinifyActive: true,
          tinifyAutoMinBytes: { not: null },
          tinifyApiKey: { not: null },
          currentTinifyUsage: { lt: 'limit-ref' },
        },
      }),
    );
  });

  it('ignores a client whose key is blank', async () => {
    const { job, prisma } = setup({
      clients: [{ ...client, tinifyApiKey: '  ' }],
    });

    await job.compressLargeImages();

    expect(prisma.image.findMany).not.toHaveBeenCalled();
  });

  it('takes optimized images above the threshold, largest first, within the budget', async () => {
    const { job, prisma } = setup({
      clients: [{ ...client, currentTinifyUsage: 495 }],
    });

    await job.compressLargeImages();

    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'c1',
        isOptimized: true,
        tinifyOptimized: false,
        tinifyAttempts: { lt: 3 },
        size: { gt: 1000 },
      },
      orderBy: { size: 'desc' },
      take: 5, // limit - usage beats TINIFY_AUTO_BATCH
      select: { id: true },
    });
  });

  it('caps a run at TINIFY_AUTO_BATCH per client', async () => {
    const { job, prisma } = setup({ batch: '7' });

    await job.compressLargeImages();

    expect(prisma.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 7 }),
    );
  });

  it('compresses each picked image through the shared method', async () => {
    const { job, imageService, metrics } = setup();

    await job.compressLargeImages();

    expect(imageService.compressImageWithTinify).toHaveBeenNthCalledWith(
      1,
      'a',
    );
    expect(imageService.compressImageWithTinify).toHaveBeenNthCalledWith(
      2,
      'b',
    );
    expect(metrics.tinifyAuto.inc).toHaveBeenCalledWith({
      result: 'compressed',
    });
  });

  it('skips without calling Tinify when the real file is under the threshold', async () => {
    const { job, imageService, prisma } = setup({
      images: [{ id: 'a' }],
      fileSize: 800,
    });

    await job.compressLargeImages();

    expect(imageService.compressImageWithTinify).not.toHaveBeenCalled();
    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { size: 800 },
    });
  });

  it('counts a failure on the image and moves on', async () => {
    const { job, imageService, prisma } = setup();
    imageService.compressImageWithTinify
      .mockRejectedValueOnce(tinifyError(500))
      .mockResolvedValueOnce({});

    await job.compressLargeImages();

    expect(prisma.image.updateMany).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { tinifyAttempts: { increment: 1 } },
    });
    expect(imageService.compressImageWithTinify).toHaveBeenCalledWith('b');
  });

  it.each([
    ['a 401 (bad key)', tinifyError(401)],
    ['a 429 (account out of compressions)', tinifyError(429)],
    [
      'our monthly limit',
      new BadRequestException({ code: TINIFY_LIMIT_REACHED, message: 'x' }),
    ],
  ])('stops the client on %s without burning attempts', async (_, error) => {
    const { job, imageService, prisma } = setup();
    imageService.compressImageWithTinify.mockRejectedValueOnce(error);

    await job.compressLargeImages();

    expect(imageService.compressImageWithTinify).toHaveBeenCalledTimes(1);
    expect(prisma.image.updateMany).not.toHaveBeenCalled();
  });
});
