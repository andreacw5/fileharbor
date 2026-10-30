import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  StreamableFile,
  ValidationPipe,
} from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { UpdateImageMetadataDto } from './dto/update-image-metadata.dto';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import { Response, Request } from 'express';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { GetImageDto } from './dto/get-image.dto';
import {
  RenderBusyException,
  StorageService,
} from '@/modules/storage/storage.service';

describe('ImageController.getImage counters', () => {
  const image = {
    id: 'img-1',
    clientId: 'client-1',
    isPrivate: false,
    originalName: 'a.png',
    updatedAt: new Date(0),
  };
  const imageService = {
    getImageById: jest.fn().mockResolvedValue(image),
    validateImageAccess: jest.fn().mockResolvedValue(undefined),
    getImageFile: jest.fn(),
    incrementViews: jest.fn().mockResolvedValue(undefined),
    incrementDownloads: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ImageController(
    imageService as unknown as ImageService,
    {} as StorageService,
    { get: jest.fn() } as unknown as ConfigService,
    { write: jest.fn() } as unknown as BastionAuditService,
  );
  const res = {
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const req = { headers: {} } as unknown as Request;

  beforeEach(() => jest.clearAllMocks());

  it('counts a view once the file is served', async () => {
    imageService.getImageFile.mockResolvedValue({
      buffer: Buffer.from('x'),
      mimeType: 'image/webp',
      filePath: 'p',
    });

    await controller.getImage('img-1', {} as GetImageDto, res, req);

    expect(imageService.incrementViews).toHaveBeenCalledWith('img-1');
  });

  it('streams a file already on disk instead of buffering it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-stream-'));
    const filePath = path.join(dir, 'original.webp');
    await fs.writeFile(filePath, Buffer.alloc(1234));
    imageService.getImageFile.mockResolvedValue({
      mimeType: 'image/webp',
      filePath,
    });

    const out = await controller.getImage('img-1', {} as GetImageDto, res, req);

    expect(out).toBeInstanceOf(StreamableFile);
    expect((out as StreamableFile).getHeaders().length).toBe(1234);
    expect(imageService.incrementViews).toHaveBeenCalledWith('img-1');
    (out as StreamableFile).getStream().destroy();
    await fs.rm(dir, { recursive: true });
  });

  it('is a 500, not a view, when the file behind the row is gone', async () => {
    imageService.getImageFile.mockResolvedValue({
      mimeType: 'image/webp',
      filePath: path.join(os.tmpdir(), 'fh-missing', 'original.webp'),
    });

    await expect(
      controller.getImage('img-1', {} as GetImageDto, res, req),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(imageService.incrementViews).not.toHaveBeenCalled();
  });

  it('does not count a view when the render queue is full', async () => {
    imageService.getImageFile.mockRejectedValue(new RenderBusyException());

    await expect(
      controller.getImage('img-1', { width: 800 } as GetImageDto, res, req),
    ).rejects.toBeInstanceOf(RenderBusyException);
    expect(imageService.incrementViews).not.toHaveBeenCalled();
  });
});

describe('ImageController.getImage ?blur=1', () => {
  const image = {
    id: 'img-1',
    clientId: 'client-1',
    isPrivate: true,
    blurPublic: false,
    originalName: 'a.png',
    updatedAt: new Date(0),
  };
  const imageService = {
    getImageById: jest.fn(),
    getImageByShareToken: jest.fn().mockRejectedValue(new NotFoundException()),
    // Like the real one for an anonymous caller: private means denied.
    validateImageAccess: jest.fn(async (img: typeof image) => {
      if (img.isPrivate) throw new ForbiddenException('private');
    }),
    getImageFile: jest.fn(),
    getImageMetadata: jest.fn(),
    incrementViews: jest.fn(),
    incrementDownloads: jest.fn(),
  };
  const storageService = {
    getDefaultImage: jest.fn().mockResolvedValue(Buffer.from('lock')),
  };
  const controller = new ImageController(
    imageService as unknown as ImageService,
    storageService as unknown as StorageService,
    { get: jest.fn() } as unknown as ConfigService,
    { write: jest.fn() } as unknown as BastionAuditService,
  );
  let headers: Record<string, string>;
  const res = {
    set: jest.fn((h: Record<string, string> | string, v?: string) => {
      if (typeof h === 'string') headers[h] = v!;
      else Object.assign(headers, h);
      return res;
    }),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const get = (query: Partial<GetImageDto>, ifNoneMatch?: string) =>
    controller.getImage('img-1', query as GetImageDto, res, {
      headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
    } as unknown as Request);
  const fileOptions = () => imageService.getImageFile.mock.calls[0][1];

  beforeEach(() => {
    jest.clearAllMocks();
    headers = {};
    imageService.getImageById.mockResolvedValue(image);
    imageService.getImageFile.mockResolvedValue({
      buffer: Buffer.from('x'),
      mimeType: 'image/webp',
      filePath: 'p',
    });
  });

  describe('owner access (private, blurPublic off)', () => {
    beforeEach(() =>
      imageService.validateImageAccess.mockResolvedValueOnce(undefined),
    );

    it('asks for the blur, never counts a view, tags its own ETag', async () => {
      await get({ blur: true, thumb: true });

      expect(fileOptions()).toMatchObject({ blur: true });
      expect(imageService.incrementViews).not.toHaveBeenCalled();
      expect(headers.ETag).toBe('"img-1-blur-0"');
      expect(headers['Cache-Control']).toBe('private, no-store');
    });

    it('passes width/height/format through, even over thumb, and tags them', async () => {
      await get({ blur: true, thumb: true, width: 300, format: 'jpeg' });

      expect(fileOptions()).toMatchObject({
        blur: true,
        width: 300,
        format: 'jpeg',
      });
      expect(headers.ETag).toBe('"img-1-blur-320--jpeg-0"');
    });

    it('gives sizes from 480 up the plain blur ETag', async () => {
      await get({ blur: true, width: 1000, height: 480 });

      expect(headers.ETag).toBe('"img-1-blur-0"');
    });

    it('does not count a view on a 304 either', async () => {
      await get({ blur: true }, '"img-1-blur-0"');

      expect(res.status).toHaveBeenCalledWith(304);
      expect(imageService.getImageFile).not.toHaveBeenCalled();
      expect(imageService.incrementViews).not.toHaveBeenCalled();
    });

    it('lets download win: the normal file, counted', async () => {
      await get({ blur: true, download: true });

      expect(fileOptions()).toMatchObject({ blur: false });
      expect(imageService.incrementDownloads).toHaveBeenCalled();
      expect(headers.ETag).not.toContain('blur');
    });
  });

  it('gives an anonymous caller the lock without blurPublic', async () => {
    await get({ blur: true });

    expect(imageService.getImageFile).not.toHaveBeenCalled();
    expect(headers['X-FileHarbor-Fallback']).toBe('not_found');
  });

  // No existence oracle: anonymous "private" and "missing" are the same response
  it('answers an anonymous denial exactly like a miss', async () => {
    await get({});
    const denied = { ...headers };
    headers = {};
    imageService.getImageById.mockRejectedValueOnce(new NotFoundException());
    await get({});

    expect(denied).toEqual(headers);
    expect(denied['X-FileHarbor-Fallback']).toBe('not_found');
    // Briefly cacheable: scanner bursts stop at nginx, a flip shows in a minute
    expect(denied['Cache-Control']).toBe('public, max-age=60');
    expect(storageService.getDefaultImage).toHaveBeenNthCalledWith(
      1,
      'not_found',
    );
    expect(storageService.getDefaultImage).toHaveBeenNthCalledWith(
      2,
      'not_found',
    );
  });

  it('still tells a caller with a valid key it was denied', async () => {
    await controller.getImage('img-1', {} as GetImageDto, res, {
      headers: {},
      clientId: 'client-2',
    } as unknown as Request);

    expect(headers['X-FileHarbor-Fallback']).toBe('permission_denied');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  describe('blurPublic', () => {
    beforeEach(() =>
      imageService.getImageById.mockResolvedValue({
        ...image,
        blurPublic: true,
      }),
    );

    it('serves the blur to anyone, publicly cacheable, no view', async () => {
      await get({ blur: true });

      expect(imageService.validateImageAccess).not.toHaveBeenCalled();
      expect(fileOptions()).toMatchObject({ blur: true });
      expect(headers['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(headers['X-FileHarbor-Fallback']).toBeUndefined();
      expect(imageService.incrementViews).not.toHaveBeenCalled();
    });

    it.each([
      ['without blur', {}],
      ['with download', { blur: true, download: true }],
    ])('keeps the original locked %s', async (_, query) => {
      await get(query);

      expect(imageService.getImageFile).not.toHaveBeenCalled();
      expect(headers['X-FileHarbor-Fallback']).toBe('not_found');
    });

    it("keeps the owner's original private: never public-cached", async () => {
      imageService.validateImageAccess.mockResolvedValueOnce(undefined);

      await get({});

      expect(fileOptions()).toMatchObject({ blur: false });
      expect(headers['Cache-Control']).toBe('private, no-store');
    });

    it('keeps the original locked behind an unknown token', async () => {
      await get({ token: 'bogus' });

      expect(imageService.validateImageAccess).toHaveBeenCalled();
      expect(imageService.getImageFile).not.toHaveBeenCalled();
      expect(headers['X-FileHarbor-Fallback']).toBe('not_found');
    });

    it('still serves only the blur behind an unknown token', async () => {
      await get({ blur: true, token: 'bogus' });

      expect(imageService.validateImageAccess).not.toHaveBeenCalled();
      expect(fileOptions()).toMatchObject({ blur: true });
    });

    it('keeps ?info locked (403)', async () => {
      await expect(get({ blur: true, info: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  it('answers a private image behind an expired link with SHARE_LINK_EXPIRED', async () => {
    const expired = new ForbiddenException({ code: 'SHARE_LINK_EXPIRED' });
    imageService.getImageByShareToken.mockRejectedValueOnce(expired);

    await expect(get({ token: 'old', info: true })).rejects.toBe(expired);
  });

  it('still serves a public image behind an expired link', async () => {
    imageService.getImageByShareToken.mockRejectedValueOnce(
      new ForbiddenException({ code: 'SHARE_LINK_EXPIRED' }),
    );
    imageService.getImageById.mockResolvedValueOnce({
      ...image,
      isPrivate: false,
    });

    await get({ token: 'old', info: true });
    expect(imageService.getImageMetadata).toHaveBeenCalled();
  });
});

describe('ImageController client-surface audit', () => {
  const imageService = {
    deleteImage: jest.fn(),
    updateImageMetadata: jest.fn(),
    validateCreatorExternalId: jest.fn((id: string) => id),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const controller = new ImageController(
    imageService as unknown as ImageService,
    {} as StorageService,
    { get: jest.fn() } as unknown as ConfigService,
    audit as unknown as BastionAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('audits a successful delete', async () => {
    imageService.deleteImage.mockResolvedValue({ success: true });

    await controller.deleteImage('client-1', 'user-1', 'img-1');

    expect(audit.write).toHaveBeenCalledWith('fh_image.deleted', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        imageId: 'img-1',
      },
    });
  });

  it('does not audit a failed delete', async () => {
    imageService.deleteImage.mockRejectedValue(new NotFoundException());

    await expect(
      controller.deleteImage('client-1', undefined, 'img-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('audits a PATCH that sets isPrivate, with the value', async () => {
    imageService.updateImageMetadata.mockResolvedValue({ id: 'img-1' });

    await controller.updateImage('client-1', 'user-1', 'img-1', {
      isPrivate: false,
    });

    expect(audit.write).toHaveBeenCalledWith('fh_image.updated', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        imageId: 'img-1',
        fields: ['isPrivate'],
        isPrivate: false,
      },
    });
  });

  it('audits a PATCH that sets blurPublic, with the value', async () => {
    imageService.updateImageMetadata.mockResolvedValue({ id: 'img-1' });

    await controller.updateImage('client-1', 'user-1', 'img-1', {
      blurPublic: true,
    });

    expect(audit.write).toHaveBeenCalledWith('fh_image.updated', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        imageId: 'img-1',
        fields: ['blurPublic'],
        blurPublic: true,
      },
    });
  });

  it('does not audit a PATCH without isPrivate', async () => {
    imageService.updateImageMetadata.mockResolvedValue({ id: 'img-1' });

    await controller.updateImage('client-1', 'user-1', 'img-1', {
      description: 'x',
    });

    expect(audit.write).not.toHaveBeenCalled();
  });
});

describe('UpdateImageMetadataDto.isPrivate', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateImageMetadataDto });

  it('rejects null instead of passing it to Prisma', async () => {
    await expect(validate({ isPrivate: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a boolean or no key at all', async () => {
    await expect(validate({ isPrivate: false })).resolves.toMatchObject({
      isPrivate: false,
    });
    await expect(validate({ description: 'x' })).resolves.not.toHaveProperty(
      'isPrivate',
    );
  });
});
