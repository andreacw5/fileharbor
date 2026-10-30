import { AvatarCleanupJob } from './avatar.cleanup.job';

describe('AvatarCleanupJob.optimizeAvatars', () => {
  it('marks the avatar optimized with the size of the re-encoded original', async () => {
    const avatarService = {
      getUnoptimizedAvatars: jest
        .fn()
        .mockResolvedValue([
          { id: 'a1', clientId: 'c', creatorId: 'cr', size: 999_999 },
        ]),
      markAsOptimized: jest.fn().mockResolvedValue(undefined),
      recordOptimizeFailure: jest.fn(),
    };
    const storage = {
      getAvatarFilePath: jest.fn((_d, id, variant) => `${id}/${variant}`),
      readFile: jest.fn().mockResolvedValue(Buffer.from('img')),
      optimizeImage: jest.fn().mockResolvedValue(Buffer.from('optimized')),
      saveFile: jest.fn().mockResolvedValue(undefined),
      createThumbnail: jest.fn().mockResolvedValue(Buffer.from('thumb')),
    };
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue(null) },
      runExclusive: (_job: string, fn: () => Promise<unknown>) => fn(),
    };
    const job = new AvatarCleanupJob(
      avatarService as any,
      storage as any,
      prisma as any,
      { get: jest.fn() } as any,
    );

    await job.optimizeAvatars();

    expect(avatarService.markAsOptimized).toHaveBeenCalledWith(
      'a1',
      Buffer.from('optimized').length,
    );
    expect(avatarService.recordOptimizeFailure).not.toHaveBeenCalled();
  });

  it('leaves the original untouched when the thumb fails', async () => {
    const avatarService = {
      getUnoptimizedAvatars: jest
        .fn()
        .mockResolvedValue([{ id: 'a1', clientId: 'c', creatorId: 'cr' }]),
      markAsOptimized: jest.fn(),
      recordOptimizeFailure: jest.fn().mockResolvedValue(false),
    };
    const storage = {
      getAvatarFilePath: jest.fn((_d, id, variant) => `${id}/${variant}`),
      readFile: jest.fn().mockResolvedValue(Buffer.from('img')),
      optimizeImage: jest.fn().mockResolvedValue(Buffer.from('optimized')),
      saveFile: jest.fn().mockResolvedValue(undefined),
      createThumbnail: jest.fn().mockRejectedValue(new Error('sharp')),
    };
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue(null) },
      runExclusive: (_job: string, fn: () => Promise<unknown>) => fn(),
    };
    const job = new AvatarCleanupJob(
      avatarService as any,
      storage as any,
      prisma as any,
      { get: jest.fn() } as any,
    );

    await job.optimizeAvatars();

    expect(storage.saveFile).not.toHaveBeenCalled();
    expect(avatarService.markAsOptimized).not.toHaveBeenCalled();
    expect(avatarService.recordOptimizeFailure).toHaveBeenCalledWith('a1');
  });
});
