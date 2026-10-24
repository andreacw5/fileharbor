import { NotFoundException } from '@nestjs/common';
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

    await controller.deleteAvatar('client-1', 'owner-1', 'actor-1');

    expect(avatarService.deleteAvatar).toHaveBeenCalledWith(
      'client-1',
      'owner-1',
    );
    expect(audit.write).toHaveBeenCalledWith('fh_avatar.deleted', {
      metadata: {
        via: 'api_key',
        clientId: 'client-1',
        externalUserId: 'actor-1',
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
});
