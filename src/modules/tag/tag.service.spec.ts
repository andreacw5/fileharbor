import { Test, TestingModule } from '@nestjs/testing';
import { TagService } from './tag.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { TagPageParams } from './dto/tag-response.dto';

function makeParams(overrides: Partial<TagPageParams> = {}): TagPageParams {
  return Object.assign(new TagPageParams(), overrides);
}

describe('TagService', () => {
  let service: TagService;

  const mockPrismaService = {
    tag: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const adminUser: AdminJwtPayload = {
    sub: 'admin-1',
    tenantId: 'tenant-1',
    tenantSlug: 'fileharbor',
    email: 'admin@example.com',
    role: 'SUPER_ADMIN',
    appSlug: 'fileharbor',
    permissions: [],
    adminUserId: 'local-admin-1',
    allClientsAccess: true,
    allowedClientIds: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<TagService>(TagService);
  });

  it('returns tag items with image counts', async () => {
    mockPrismaService.tag.findMany.mockResolvedValue([
      {
        name: 'nature',
        _count: {
          imageTags: 3,
        },
      },
      {
        name: 'travel',
        _count: {
          imageTags: 1,
        },
      },
    ]);
    mockPrismaService.tag.count.mockResolvedValue(2);

    const result = await service.listTags(adminUser, { search: 'na' }, makeParams({ limit: 100 }));

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith({
      where: {
        name: {
          contains: 'na',
          mode: 'insensitive',
        },
      },
      orderBy: {
        name: 'asc',
      },
      skip: 0,
      take: 100,
      select: {
        name: true,
        _count: {
          select: {
            imageTags: true,
          },
        },
      },
    });

    expect(result).toEqual({
      data: [
        { name: 'nature', imageCount: 3 },
        { name: 'travel', imageCount: 1 },
      ],
      meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });
  });

  it('defaults to the first page of 200', async () => {
    mockPrismaService.tag.findMany.mockResolvedValue([]);
    mockPrismaService.tag.count.mockResolvedValue(0);

    const result = await service.listTags(adminUser);

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 200 }),
    );
    expect(result.meta).toEqual({ page: 1, limit: 200, total: 0, totalPages: 0 });
  });

  it('skips by page and reports the total across all pages', async () => {
    mockPrismaService.tag.findMany.mockResolvedValue([
      { name: 'sunset', _count: { imageTags: 7 } },
    ]);
    mockPrismaService.tag.count.mockResolvedValue(451);

    const result = await service.listTags(adminUser, {}, makeParams({ page: 3, limit: 50 }));

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50 }),
    );
    // `meta.total` is the whole matching set, not the single row on this page.
    expect(result.meta.total).toBe(451);
    expect(result.meta).toEqual({ page: 3, limit: 50, total: 451, totalPages: 10 });
  });

  it('caps perPage at 500 and floors page at 1', async () => {
    mockPrismaService.tag.findMany.mockResolvedValue([]);
    mockPrismaService.tag.count.mockResolvedValue(0);

    // class-validator enforces @Min(1) / @Max(500) at the DTO level;
    // TagPageParams defaults cap limit at 500 and page at 1.
    const result = await service.listTags(adminUser, {}, makeParams({ limit: 500 }));

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 500 }),
    );
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(500);
  });

  it('scopes the query to the clients a restricted admin can reach', async () => {
    mockPrismaService.tag.findMany.mockResolvedValue([]);
    mockPrismaService.tag.count.mockResolvedValue(0);

    const restricted: AdminJwtPayload = {
      ...adminUser,
      role: 'ADMIN',
      allClientsAccess: false,
      allowedClientIds: ['client-a', 'client-b'],
    };

    await service.listTags(restricted, {});

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: { in: ['client-a', 'client-b'] } },
      }),
    );
    expect(mockPrismaService.tag.count).toHaveBeenCalledWith({
      where: { clientId: { in: ['client-a', 'client-b'] } },
    });
  });
});
