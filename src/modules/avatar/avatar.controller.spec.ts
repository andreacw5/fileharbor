import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';

describe('AvatarController client-surface audit', () => {
  const avatarService = { deleteAvatar: jest.fn() };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const controller = new AvatarController(
    avatarService as unknown as AvatarService,
    audit as unknown as BastionAuditService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('audits a successful delete: actor from X-User-Id, owner from the path', async () => {
    avatarService.deleteAvatar.mockResolvedValue({ success: true });

    await controller.deleteAvatar('client-1', 'owner-1', 'owner-1');

    expect(avatarService.deleteAvatar).toHaveBeenCalledWith(
      'client-1',
      'owner-1',
    );
    expect(audit.write).toHaveBeenCalledWith('fh_avatar.deleted', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'owner-1',
        ownerExternalUserId: 'owner-1',
      },
    });
  });

  it('does not audit a failed delete', async () => {
    avatarService.deleteAvatar.mockRejectedValue(new NotFoundException());

    await expect(
      controller.deleteAvatar('client-1', 'owner-1', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("refuses an X-User-Id acting on someone else's avatar", async () => {
    await expect(
      controller.deleteAvatar('client-1', 'owner-1', 'other-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.uploadAvatar(
        'client-1',
        {} as Express.Multer.File,
        'owner-1',
        'other-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(avatarService.deleteAvatar).not.toHaveBeenCalled();
  });

  it('lets the client backend (no X-User-Id) delete any avatar', async () => {
    avatarService.deleteAvatar.mockResolvedValue({ success: true });
    await controller.deleteAvatar('client-1', 'owner-1', undefined);
    expect(avatarService.deleteAvatar).toHaveBeenCalledWith(
      'client-1',
      'owner-1',
    );
  });
});
