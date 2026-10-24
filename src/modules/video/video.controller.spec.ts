import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { StorageService } from '@/modules/storage/storage.service';

describe('VideoController client-surface audit', () => {
  const videoService = {
    deleteVideo: jest.fn(),
    updateVideoMetadata: jest.fn(),
    validateCreatorExternalId: jest.fn((id: string) => id),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const controller = new VideoController(
    videoService as unknown as VideoService,
    {} as StorageService,
    { get: jest.fn() } as unknown as ConfigService,
    audit as unknown as BastionAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('audits a successful delete', async () => {
    videoService.deleteVideo.mockResolvedValue({ success: true });

    await controller.deleteVideo('vid-1', 'client-1', 'user-1');

    expect(audit.write).toHaveBeenCalledWith('fh_video.deleted', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        videoId: 'vid-1',
      },
    });
  });

  it('does not audit a failed delete', async () => {
    videoService.deleteVideo.mockRejectedValue(new NotFoundException());

    await expect(
      controller.deleteVideo('vid-1', 'client-1', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('audits a PATCH that sets isPrivate, with the value', async () => {
    videoService.updateVideoMetadata.mockResolvedValue({ id: 'vid-1' });

    await controller.updateVideo('vid-1', 'client-1', 'user-1', {
      isPrivate: true,
    });

    expect(audit.write).toHaveBeenCalledWith('fh_video.updated', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        videoId: 'vid-1',
        fields: ['isPrivate'],
        isPrivate: true,
      },
    });
  });

  it('does not audit a PATCH without isPrivate', async () => {
    videoService.updateVideoMetadata.mockResolvedValue({ id: 'vid-1' });

    await controller.updateVideo('vid-1', 'client-1', 'user-1', {
      description: 'x',
    });

    expect(audit.write).not.toHaveBeenCalled();
  });

  it('does not audit a refused PATCH', async () => {
    videoService.updateVideoMetadata.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      controller.updateVideo('vid-1', 'client-1', 'user-1', {
        isPrivate: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.write).not.toHaveBeenCalled();
  });
});
