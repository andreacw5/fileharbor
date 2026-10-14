import { ConfigService } from '@nestjs/config';
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
