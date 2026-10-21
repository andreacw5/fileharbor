import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ImagesAdminController } from './images-admin.controller';
import { ImageService } from '@/modules/image/image.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';

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
});
