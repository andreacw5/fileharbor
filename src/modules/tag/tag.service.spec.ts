import { Test, TestingModule } from '@nestjs/testing';
import { TagService } from './tag.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';

describe('TagService', () => {
  let service: TagService;

  const mockPrismaService = {
    tag: {
      findMany: jest.fn(),
    },
  };

  const adminUser: AdminJwtPayload = {
    sub: 'admin-1',
    email: 'admin@example.com',
    role: 'SUPER_ADMIN',
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

    const result = await service.listTags(adminUser, {
      search: 'na',
      limit: 100,
    });

    expect(mockPrismaService.tag.findMany).toHaveBeenCalledWith({
      where: {
        imageTags: {
          some: {},
        },
        name: {
          contains: 'na',
          mode: 'insensitive',
        },
      },
      orderBy: {
        name: 'asc',
      },
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
      tags: [
        {
          name: 'nature',
          imageCount: 3,
        },
        {
          name: 'travel',
          imageCount: 1,
        },
      ],
      total: 2,
    });
  });
});

