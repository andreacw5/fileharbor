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
      clearImageVariants: jest.fn().mockResolvedValue(undefined),
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
    // the size of the re-encoded buffer, not the upload-time one
    expect(imageService.markAsOptimized).toHaveBeenCalledWith(
      'ok',
      Buffer.from('opt').length,
    );
  });

  it('still marks the row optimized when clearing variants fails', async () => {
    const imageService = {
      getUnoptimizedImages: jest
        .fn()
        .mockResolvedValue([
          { id: 'i1', clientId: 'c', storagePath: 'x/images/i1' },
        ]),
      markAsOptimized: jest.fn(),
      recordOptimizeFailure: jest.fn(),
    };
    const storage = {
      getImageFilePath: jest.fn((_d, id, variant) => `${id}/${variant}`),
      readFile: jest.fn().mockResolvedValue(Buffer.from('img')),
      optimizeImage: jest.fn().mockResolvedValue(Buffer.from('opt')),
      saveFile: jest.fn().mockResolvedValue(undefined),
      clearImageVariants: jest.fn().mockRejectedValue(new Error('EACCES')),
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

    // The original is already q85 on disk: failing the row would re-encode it
    expect(imageService.markAsOptimized).toHaveBeenCalledWith('i1', 3);
    expect(imageService.recordOptimizeFailure).not.toHaveBeenCalled();
  });

  it('leaves the original untouched when the thumb fails', async () => {
    const imageService = {
      getUnoptimizedImages: jest
        .fn()
        .mockResolvedValue([
          { id: 'i1', clientId: 'c', storagePath: 'x/images/i1' },
        ]),
      markAsOptimized: jest.fn(),
      recordOptimizeFailure: jest.fn().mockResolvedValue(false),
    };
    const storage = {
      getImageFilePath: jest.fn((_d, id, variant) => `${id}/${variant}`),
      readFile: jest.fn().mockResolvedValue(Buffer.from('img')),
      optimizeImage: jest.fn().mockResolvedValue(Buffer.from('opt')),
      saveFile: jest.fn().mockResolvedValue(undefined),
      clearImageVariants: jest.fn(),
      createThumbnail: jest.fn().mockRejectedValue(new Error('sharp')),
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

    expect(storage.saveFile).not.toHaveBeenCalled();
    expect(imageService.markAsOptimized).not.toHaveBeenCalled();
    expect(imageService.recordOptimizeFailure).toHaveBeenCalledWith('i1');
  });
});
