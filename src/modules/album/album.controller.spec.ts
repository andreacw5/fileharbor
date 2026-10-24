import { ForbiddenException } from '@nestjs/common';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import { AlbumController } from './album.controller';
import { AlbumService } from './album.service';

describe('AlbumController client-surface audit', () => {
  const albumService = { deleteAlbum: jest.fn() };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const controller = new AlbumController(
    albumService as unknown as AlbumService,
    audit as unknown as BastionAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('audits a successful delete', async () => {
    albumService.deleteAlbum.mockResolvedValue({ success: true });

    await controller.deleteAlbum('client-1', 'user-1', 'album-1');

    expect(audit.write).toHaveBeenCalledWith('fh_album.deleted', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'user-1',
        albumId: 'album-1',
      },
    });
  });

  it('does not audit a refused delete', async () => {
    albumService.deleteAlbum.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.deleteAlbum('client-1', 'other', 'album-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.write).not.toHaveBeenCalled();
  });
});
