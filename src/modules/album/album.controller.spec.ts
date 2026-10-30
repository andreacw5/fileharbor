import { ForbiddenException } from '@nestjs/common';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import { AlbumController } from './album.controller';
import { AlbumService } from './album.service';
import type { CreatorService } from '@/modules/creator/creator.service';

// X-User-Id `user-1` is the creator `creator-<user-1>` inside FileHarbor
const creatorService = {
  resolveCreator: jest.fn(async (_c: string, ext: string) => ({
    id: `creator-<${ext}>`,
  })),
};

describe('AlbumController client-surface audit', () => {
  const albumService = { deleteAlbum: jest.fn() };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const controller = new AlbumController(
    albumService as unknown as AlbumService,
    creatorService as unknown as CreatorService,
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

describe('AlbumController X-User-Id resolution', () => {
  const albumService = {
    createAlbum: jest.fn(),
    updateAlbum: jest.fn(),
    addItemsToAlbum: jest.fn(),
    getAlbumWithItems: jest.fn(),
    findCreatorId: jest.fn().mockResolvedValue('creator-<user-1>'),
  };
  const controller = new AlbumController(
    albumService as unknown as AlbumService,
    creatorService as unknown as CreatorService,
    { write: jest.fn() } as unknown as BastionAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates the album under the internal Creator.id, not the raw header', async () => {
    await controller.createAlbum('client-1', 'user-1', { name: 'a' } as any);

    expect(creatorService.resolveCreator).toHaveBeenCalledWith(
      'client-1',
      'user-1',
    );
    expect(albumService.createAlbum).toHaveBeenCalledWith(
      'client-1',
      'creator-<user-1>',
      { name: 'a' },
    );
  });

  it('checks write ownership against the internal id', async () => {
    await controller.updateAlbum('client-1', 'user-1', 'album-1', {} as any);
    expect(albumService.updateAlbum).toHaveBeenCalledWith(
      'album-1',
      'client-1',
      'creator-<user-1>',
      {},
    );

    await controller.addItems('client-1', 'user-1', 'album-1', {
      items: [],
    } as any);
    expect(albumService.addItemsToAlbum).toHaveBeenCalledWith(
      'album-1',
      'client-1',
      [],
      { creatorId: 'creator-<user-1>' },
    );
  });

  it('reads with a lookup, never creating a creator', async () => {
    await controller.getAlbum('client-1', 'user-1', 'album-1');

    expect(creatorService.resolveCreator).not.toHaveBeenCalled();
    expect(albumService.getAlbumWithItems).toHaveBeenCalledWith(
      'album-1',
      'client-1',
      'creator-<user-1>',
    );
  });

  it('still requires X-User-Id on writes', async () => {
    await expect(
      controller.createAlbum('client-1', undefined as any, {} as any),
    ).rejects.toThrow('X-User-Id');
    expect(albumService.createAlbum).not.toHaveBeenCalled();
  });
});
