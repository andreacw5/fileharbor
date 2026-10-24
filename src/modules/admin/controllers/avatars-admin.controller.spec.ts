import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AvatarsAdminController } from './avatars-admin.controller';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { RouteHelperService } from '@/utils/route.utils';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';

describe('AvatarsAdminController.listAvatars', () => {
  const avatarService = {
    findAdminAvatars: jest.fn().mockResolvedValue({ avatars: [], total: 0 }),
  };
  const controller = new AvatarsAdminController(
    avatarService as unknown as AvatarService,
    {} as RouteHelperService,
  );
  const admin = { allowedClientIds: ['client-1'] } as AdminJwtPayload;
  const whereOf = () => avatarService.findAdminAvatars.mock.calls[0][0];

  beforeEach(() => jest.clearAllMocks());

  it('matches search on the creator username or external id', async () => {
    await controller.listAvatars(admin, undefined, undefined, ' Kaish ');
    expect(whereOf()).toEqual({
      clientId: { in: ['client-1'] },
      creator: {
        OR: [
          { externalId: { contains: 'Kaish', mode: 'insensitive' } },
          { username: { contains: 'Kaish', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('keeps creatorId an exact external id match next to search', async () => {
    await controller.listAvatars(admin, undefined, 'ext-1', 'k');
    expect(whereOf().creator).toMatchObject({ externalId: 'ext-1' });
    expect(whereOf().creator.OR).toHaveLength(2);
  });

  it('filters on optimize status inside the scope', async () => {
    await controller.listAvatars(
      admin,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'pending',
    );
    expect(whereOf()).toEqual({
      clientId: { in: ['client-1'] },
      isOptimized: false,
      optimizeAttempts: { lt: 3 },
    });
  });

  it('adds no creator filter without creatorId or search', async () => {
    await controller.listAvatars(admin, undefined, undefined, '  ');
    expect(whereOf()).toEqual({ clientId: { in: ['client-1'] } });
  });
});

describe('AvatarsAdminController reoptimize', () => {
  const avatarService = {
    getAvatarById: jest.fn(),
    resetOptimizeAttempts: jest.fn(),
  };
  const controller = new AvatarsAdminController(
    avatarService as unknown as AvatarService,
    {} as RouteHelperService,
  );
  const admin = {
    allowedClientIds: ['client-1', 'client-2'],
  } as AdminJwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    avatarService.getAvatarById.mockResolvedValue({
      id: 'av-1',
      clientId: 'client-1',
    });
  });

  it('re-queues one avatar', async () => {
    avatarService.resetOptimizeAttempts.mockResolvedValue(1);
    await expect(
      controller.reoptimizeAvatar('av-1', admin),
    ).resolves.toBeUndefined();
    expect(avatarService.resetOptimizeAttempts).toHaveBeenCalledWith({
      id: 'av-1',
    });
  });

  it('404s on a missing avatar', async () => {
    avatarService.getAvatarById.mockResolvedValue(null);
    await expect(
      controller.reoptimizeAvatar('av-1', admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(avatarService.resetOptimizeAttempts).not.toHaveBeenCalled();
  });

  it('409s on an avatar already optimized', async () => {
    avatarService.resetOptimizeAttempts.mockResolvedValue(0);
    await expect(
      controller.reoptimizeAvatar('av-1', admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a client out of scope without touching the row', async () => {
    avatarService.getAvatarById.mockResolvedValue({
      id: 'av-1',
      clientId: 'client-9',
    });
    await expect(
      controller.reoptimizeAvatar('av-1', admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(avatarService.resetOptimizeAttempts).not.toHaveBeenCalled();
  });

  it('re-queues every failed avatar in scope', async () => {
    avatarService.resetOptimizeAttempts.mockResolvedValue(3);
    await expect(
      controller.reoptimizeFailedAvatars({}, admin),
    ).resolves.toEqual({ count: 3 });
    expect(avatarService.resetOptimizeAttempts).toHaveBeenCalledWith({
      clientId: { in: ['client-1', 'client-2'] },
      isOptimized: false,
      optimizeAttempts: { gte: 3 },
    });
  });

  it('refuses a bulk on a client out of scope', async () => {
    await expect(
      controller.reoptimizeFailedAvatars({ clientId: 'client-9' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(avatarService.resetOptimizeAttempts).not.toHaveBeenCalled();
  });
});
