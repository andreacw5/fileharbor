import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
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

  it('does not audit a PATCH without isPrivate', async () => {
    imageService.updateImageMetadata.mockResolvedValue({ id: 'img-1' });

    await controller.updateImage('client-1', 'user-1', 'img-1', {
      description: 'x',
    });

    expect(audit.write).not.toHaveBeenCalled();
  });
});
