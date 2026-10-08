import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { GetAvatarDto } from './dto';

describe('AvatarService.getAvatarFile format', () => {
  const stored = Buffer.from('stored-webp');
  const prisma = {
    creator: {
      findUnique: jest.fn().mockResolvedValue({ id: 'creator-1' }),
      findFirst: jest.fn(),
    },
    avatar: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ clientId: 'client-1', mimeType: 'image/webp' }),
    },
    client: { findUnique: jest.fn().mockResolvedValue({ domain: 'test' }) },
  };
  const storage = {
    getAvatarFilePath: jest.fn().mockReturnValue('path'),
    readFile: jest.fn().mockResolvedValue(stored),
    resizeImage: jest.fn().mockResolvedValue(Buffer.from('png')),
  };
  const config = { get: jest.fn() };
  const service = new AvatarService(
    prisma as any,
    storage as any,
    config as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => storage.resizeImage.mockClear());

  it('returns the stored webp bytes untouched when no format is given', async () => {
    const res = await service.getAvatarFile('client-1', 'ext-1');
    expect(res).toEqual({ buffer: stored, mimeType: 'image/webp' });
    expect(storage.resizeImage).not.toHaveBeenCalled();
  });

  it('scopes the creator lookup to the client', async () => {
    await service.getAvatarFile('client-1', 'ext-1');
    expect(prisma.creator.findUnique).toHaveBeenLastCalledWith({
      where: {
        clientId_externalId: { clientId: 'client-1', externalId: 'ext-1' },
      },
    });
    expect(prisma.creator.findFirst).not.toHaveBeenCalled();
  });

  it('converts to png when format=png (thumb too)', async () => {
    const res = await service.getAvatarFile('client-1', 'ext-1', true, 'png');
    expect(res.mimeType).toBe('image/png');
    expect(storage.getAvatarFilePath).toHaveBeenLastCalledWith(
      'test',
      'creator-1',
      'thumb',
    );
    expect(storage.resizeImage).toHaveBeenCalledWith(
      stored,
      undefined,
      undefined,
      'png',
    );
  });
});

describe('GetAvatarDto format validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (value: Record<string, string>) =>
    pipe.transform(value, { type: 'query', metatype: GetAvatarDto });

  it('accepts format=png', async () => {
    await expect(validate({ format: 'png' })).resolves.toMatchObject({
      format: 'png',
    });
  });

  it('rejects an unknown format with 400', async () => {
    await expect(validate({ format: 'gif' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
