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

  it('adds no creator filter without creatorId or search', async () => {
    await controller.listAvatars(admin, undefined, undefined, '  ');
    expect(whereOf()).toEqual({ clientId: { in: ['client-1'] } });
  });
});
