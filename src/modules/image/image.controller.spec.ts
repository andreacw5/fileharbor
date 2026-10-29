import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
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
      await get({ blur: true, width: 800, thumb: true });

      expect(fileOptions()).toMatchObject({ blur: true });
      expect(imageService.incrementViews).not.toHaveBeenCalled();
      expect(headers.ETag).toBe('"img-1-blur-0"');
      expect(headers['Cache-Control']).toBe('private, no-store');
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
    expect(headers['X-FileHarbor-Fallback']).toBe('permission_denied');
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
      expect(headers['X-FileHarbor-Fallback']).toBe('permission_denied');
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
      expect(headers['X-FileHarbor-Fallback']).toBe('permission_denied');
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
