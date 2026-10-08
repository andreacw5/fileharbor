import { ImageCleanupJob } from './image.cleanup.job';

describe('ImageCleanupJob.optimizeImages', () => {
  it('counts a failure instead of marking the image optimized, and keeps going', async () => {
    const imageService = {
      getUnoptimizedImages: jest.fn().mockResolvedValue([
        { id: 'broken', clientId: 'c', storagePath: 'x/images/broken' },
        { id: 'ok', clientId: 'c', storagePath: 'x/images/ok' },
      ]),
      markAsOptimized: jest.fn().mockResolvedValue(undefined),
      recordOptimizeFailure: jest.fn().mockResolvedValue(true),
    };
    const storage = {
      getImageFilePath: jest.fn((_d, id, variant) => `${id}/${variant}`),
      readFile: jest.fn(async (p: string) => {
        if (p.startsWith('broken')) throw new Error('ENOENT');
        return Buffer.from('img');
      }),
      optimizeImage: jest.fn().mockResolvedValue(Buffer.from('opt')),
      saveFile: jest.fn().mockResolvedValue(undefined),
      createThumbnail: jest.fn().mockResolvedValue(Buffer.from('thumb')),
    };
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue(null) },
      runExclusive: (_job: string, fn: () => Promise<unknown>) => fn(),
    };
    const job = new ImageCleanupJob(
      imageService as any,
      storage as any,
      prisma as any,
      { get: jest.fn() } as any,
    );

    await job.optimizeImages();

    expect(imageService.recordOptimizeFailure).toHaveBeenCalledWith('broken');
    expect(imageService.markAsOptimized).toHaveBeenCalledTimes(1);
    expect(imageService.markAsOptimized).toHaveBeenCalledWith('ok');
  });
});
