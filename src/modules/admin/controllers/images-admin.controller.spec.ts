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
