import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ImagesAdminController } from './images-admin.controller';
import { ImageService } from '@/modules/image/image.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { AdminDuplicateListQuery } from '../dto/admin-duplicates.dto';

describe('ImagesAdminController.getImageFile', () => {
  const image = {
    id: 'img-1',
    clientId: 'client-1',
    isPrivate: true,
    originalName: 'a.png',
  };
  const imageService = {
    getImageById: jest.fn(),
    getImageFile: jest.fn(),
    incrementViews: jest.fn().mockResolvedValue(undefined),
    incrementDownloads: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ImagesAdminController(
    imageService as unknown as ImageService,
    {} as RouteHelperService,
  );
  const res = { set: jest.fn().mockReturnThis() };
  const admin = (allowedClientIds: string[]) =>
    ({ allowedClientIds }) as AdminJwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    imageService.getImageById.mockResolvedValue(image);
    imageService.getImageFile.mockResolvedValue({
      buffer: Buffer.from('abc'),
      mimeType: 'image/webp',
    });
  });

  it('serves a private image inline to an admin with access, counting nothing', async () => {
    const file = await controller.getImageFile(
      'img-1',
      true,
      res as unknown as Response,
      admin(['client-1']),
    );

    expect(file.getHeaders()).toMatchObject({
      type: 'image/webp',
      length: 3,
    });
    expect(imageService.getImageFile).toHaveBeenCalledWith(image, {
      thumb: true,
    });
    const headers = res.set.mock.calls[0][0] as Record<string, string>;
    expect(headers).toEqual({
      'Content-Type': 'image/webp',
      'Content-Length': '3',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(file.getHeaders().disposition).toBeUndefined();
    expect(imageService.incrementViews).not.toHaveBeenCalled();
    expect(imageService.incrementDownloads).not.toHaveBeenCalled();
  });

  it('refuses an admin without access to the client', async () => {
    await expect(
      controller.getImageFile(
        'img-1',
        false,
        res as unknown as Response,
        admin(['client-2']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(imageService.getImageFile).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });

  it('propagates 404 for a missing image', async () => {
    imageService.getImageById.mockRejectedValue(
      new NotFoundException('Image not found'),
    );

    await expect(
      controller.getImageFile(
        'nope',
        false,
        res as unknown as Response,
        admin(['client-1']),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ImagesAdminController.listImages', () => {
  const imageService = { findAdminImages: jest.fn().mockResolvedValue({}) };
  const controller = new ImagesAdminController(
    imageService as unknown as ImageService,
    {} as RouteHelperService,
  );
  const admin = { allowedClientIds: ['client-1'] } as AdminJwtPayload;
  const list = (isPrivate?: string) =>
    controller.listImages(
      admin,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      isPrivate,
    );
  const where = () => imageService.findAdminImages.mock.calls[0][0];

  beforeEach(() => jest.clearAllMocks());

  it('filters on privacy across the whole result, not one page', async () => {
    await list('true');
    expect(where()).toEqual({
      clientId: { in: ['client-1'] },
      isPrivate: true,
    });
  });

  it('filters on public files', async () => {
    await list('false');
    expect(where().isPrivate).toBe(false);
  });

  it('leaves privacy alone when the flag is absent', async () => {
    await list();
    expect(where()).not.toHaveProperty('isPrivate');
  });

  it('rejects a malformed flag before querying', async () => {
    await expect(list('yes')).rejects.toThrow(
      'isPrivate must be true or false',
    );
    expect(imageService.findAdminImages).not.toHaveBeenCalled();
  });

  const byHash = (dHash: string) =>
    controller.listImages(
      admin,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      dHash,
    );

  it('filters on dHash inside the scope', async () => {
    await byHash('00ff00ff00ff00ff');
    expect(where()).toEqual({
      clientId: { in: ['client-1'] },
      dHash: '00ff00ff00ff00ff',
    });
  });

  it('rejects a malformed dHash before querying', async () => {
    await expect(byHash('00FF')).rejects.toThrow(
      'dHash must be 16 hex characters',
    );
    expect(imageService.findAdminImages).not.toHaveBeenCalled();
  });
});

describe('ImagesAdminController.listDuplicates', () => {
  const imageService = { findDuplicateGroups: jest.fn().mockResolvedValue({}) };
  const controller = new ImagesAdminController(
    imageService as unknown as ImageService,
    {} as RouteHelperService,
  );
  const admin = (fullAccess = false) =>
    ({
      allowedClientIds: ['client-1', 'client-2'],
      fullAccess,
    }) as AdminJwtPayload;
  const query = (q: Partial<AdminDuplicateListQuery>) =>
    Object.assign(new AdminDuplicateListQuery(), q);

  beforeEach(() => jest.clearAllMocks());

  it('groups inside the caller scope by default', async () => {
    const q = query({});
    await controller.listDuplicates(admin(), q);
    expect(imageService.findDuplicateGroups).toHaveBeenCalledWith(
      ['client-1', 'client-2'],
      { creatorId: undefined, crossClient: false },
      q,
    );
  });

  it('narrows to one client the caller sees', async () => {
    await controller.listDuplicates(admin(), query({ clientId: 'client-2' }));
    expect(imageService.findDuplicateGroups.mock.calls[0][0]).toEqual([
      'client-2',
    ]);
  });

  it('refuses a client outside the scope', async () => {
    await expect(
      controller.listDuplicates(admin(), query({ clientId: 'client-9' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(imageService.findDuplicateGroups).not.toHaveBeenCalled();
  });

  it('allows crossClient only with fullAccess', async () => {
    await expect(
      controller.listDuplicates(admin(false), query({ crossClient: true })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(imageService.findDuplicateGroups).not.toHaveBeenCalled();

    await controller.listDuplicates(admin(true), query({ crossClient: true }));
    expect(imageService.findDuplicateGroups.mock.calls[0][1]).toEqual({
      creatorId: undefined,
      crossClient: true,
    });
  });
});

describe('ImagesAdminController.bulkDeleteImages', () => {
  const imageService = {
    findImageClients: jest.fn(),
    deleteImage: jest.fn(),
  };
  const controller = new ImagesAdminController(
    imageService as unknown as ImageService,
    {} as RouteHelperService,
  );
  const admin = { allowedClientIds: ['client-1'] } as AdminJwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    imageService.findImageClients.mockResolvedValue(
      new Map([
        ['img-1', 'client-1'],
        ['img-2', 'client-2'],
        ['img-3', 'client-1'],
      ]),
    );
    imageService.deleteImage.mockImplementation((id: string) =>
      id === 'img-3'
        ? Promise.reject(new Error('disk on fire'))
        : Promise.resolve(undefined),
    );
  });

  it('deletes what it can and reports the rest, without telling missing from forbidden', async () => {
    const res = await controller.bulkDeleteImages(
      { ids: ['img-1', 'img-2', 'img-3', 'img-4'] },
      admin,
    );

    expect(imageService.findImageClients).toHaveBeenCalledTimes(1);
    expect(imageService.deleteImage).toHaveBeenCalledTimes(2);
    expect(imageService.deleteImage).toHaveBeenCalledWith('img-1', 'client-1');
    expect(res).toEqual({
      deleted: ['img-1'],
      failed: [
        { id: 'img-2', message: 'Image not found' },
        { id: 'img-3', message: 'disk on fire' },
        { id: 'img-4', message: 'Image not found' },
      ],
    });
  });
});

describe('ImagesAdminController.regenerateImage', () => {
  const image = { id: 'img-1', clientId: 'client-1' };
  const imageService = {
    getImageById: jest.fn(),
    regenerateRenditions: jest.fn(),
  };
  const controller = new ImagesAdminController(
    imageService as unknown as ImageService,
    {} as RouteHelperService,
  );
  const admin = (allowedClientIds: string[]) =>
    ({ allowedClientIds }) as AdminJwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    imageService.getImageById.mockResolvedValue(image);
  });

  it('returns the new updatedAt', async () => {
    const updatedAt = new Date();
    imageService.regenerateRenditions.mockResolvedValue({
      id: 'img-1',
      updatedAt,
    });
    await expect(
      controller.regenerateImage('img-1', admin(['client-1'])),
    ).resolves.toEqual({ id: 'img-1', updatedAt });
    expect(imageService.regenerateRenditions).toHaveBeenCalledWith(image);
  });

  it('refuses a client out of scope before touching the files', async () => {
    await expect(
      controller.regenerateImage('img-1', admin(['client-2'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(imageService.regenerateRenditions).not.toHaveBeenCalled();
  });
});
