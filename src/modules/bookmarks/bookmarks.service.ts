import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import { assertClientAccess, buildClientWhere } from '@/modules/admin/helpers/admin-access.helper';
import { extractTagNames, normalizeTagNames } from '@/modules/tag/tag.utils';
import { RouteHelperService } from '@/utils/route.utils';

export type AdminBookmarksListParams = {
  clientId?: string;
  search?: string;
  tags?: string[];
  page?: number;
  perPage?: number;
};

export type AdminUserBookmarksListParams = {
  clientId?: string;
  search?: string;
  page?: number;
  perPage?: number;
};

@Injectable()
export class BookmarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly route: RouteHelperService,
  ) {}

  async listBookmarks(adminUser: AdminJwtPayload, params: AdminBookmarksListParams) {
    const page = Math.max(Number(params.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(params.perPage) || 20, 1), 100);
    const skip = (page - 1) * perPage;
    const now = new Date();

    const where: any = {
      adminUserId: adminUser.adminUserId,
      image: buildClientWhere(adminUser, params.clientId),
    };

    if (params.search) {
      where.image.originalName = { contains: params.search, mode: 'insensitive' };
    }

    const tags = normalizeTagNames(params.tags);
    if (tags.length > 0) {
      where.image.imageTags = {
        some: {
          tag: {
            name: { in: tags },
          },
        },
      };
    }

    const prisma = this.prisma as any;

    const [rows, total] = await Promise.all([
      prisma.adminImageBookmark.findMany({
        where,
        include: this.buildBookmarkInclude(now),
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      prisma.adminImageBookmark.count({ where }),
    ]);

    return {
      data: rows.map((bookmark) => this.mapBookmark(bookmark)),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async bookmarkImage(adminUser: AdminJwtPayload, imageId: string) {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
      select: { id: true, clientId: true },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    assertClientAccess(adminUser, image.clientId);

    const prisma = this.prisma as any;

    await prisma.adminImageBookmark.upsert({
      where: {
        adminUserId_imageId: {
          adminUserId: adminUser.adminUserId,
          imageId,
        },
      },
      create: {
        adminUserId: adminUser.adminUserId,
        imageId,
      },
      update: {},
    });

    return this.getBookmarkByAdminAndImage(adminUser.adminUserId, imageId);
  }

  async bookmarkUser(adminUser: AdminJwtPayload, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, clientId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    assertClientAccess(adminUser, user.clientId);

    const prisma = this.prisma as any;

    await prisma.adminUserBookmark.upsert({
      where: {
        adminUserId_userId: {
          adminUserId: adminUser.adminUserId,
          userId,
        },
      },
      create: {
        adminUserId: adminUser.adminUserId,
        userId,
      },
      update: {},
    });

    return this.getBookmarkByAdminAndUser(adminUser.adminUserId, userId);
  }

  async removeBookmark(adminUser: AdminJwtPayload, imageId: string): Promise<{ removed: number }> {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
      select: { id: true, clientId: true },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    assertClientAccess(adminUser, image.clientId);

    const prisma = this.prisma as any;

    const result = await prisma.adminImageBookmark.deleteMany({
      where: {
        adminUserId: adminUser.adminUserId,
        imageId,
      },
    });

    return { removed: result.count };
  }

  async removeUserBookmark(adminUser: AdminJwtPayload, userId: string): Promise<{ removed: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, clientId: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    assertClientAccess(adminUser, user.clientId);

    const prisma = this.prisma as any;

    const result = await prisma.adminUserBookmark.deleteMany({
      where: {
        adminUserId: adminUser.adminUserId,
        userId,
      },
    });

    return { removed: result.count };
  }

  private async getBookmarkByAdminAndImage(adminUserId: string, imageId: string) {
    const prisma = this.prisma as any;

    const bookmark = await prisma.adminImageBookmark.findUnique({
      where: {
        adminUserId_imageId: {
          adminUserId,
          imageId,
        },
      },
      include: this.buildBookmarkInclude(new Date()),
    });

    if (!bookmark) {
      throw new BadRequestException('Bookmark could not be created');
    }

    return this.mapBookmark(bookmark);
  }

  private async getBookmarkByAdminAndUser(adminUserId: string, userId: string) {
    const prisma = this.prisma as any;

    const bookmark = await prisma.adminUserBookmark.findUnique({
      where: {
        adminUserId_userId: {
          adminUserId,
          userId,
        },
      },
      include: this.buildUserBookmarkInclude(),
    });

    if (!bookmark) {
      throw new BadRequestException('Bookmark could not be created');
    }

    return this.mapUserBookmark(bookmark);
  }

  private buildBookmarkInclude(now: Date) {
    return {
      image: {
        include: {
          imageTags: {
            include: {
              tag: { select: { name: true } },
            },
          },
          client: { select: { id: true, name: true, domain: true } },
          user: { select: { externalUserId: true, username: true } },
          albumImages: {
            include: {
              album: {
                select: { id: true, name: true, externalAlbumId: true, isPublic: true },
              },
            },
          },
          _count: {
            select: {
              shareLinks: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
            },
          },
        },
      },
    };
  }

  private buildUserBookmarkInclude() {
    return {
      user: {
        include: {
          client: { select: { id: true, name: true, domain: true } },
          _count: {
            select: {
              images: true,
              avatars: true,
              albums: true,
            },
          },
        },
      },
    };
  }

  private mapBookmark(bookmark: any) {
    const image = bookmark.image;

    return {
      id: bookmark.id,
      adminUserId: bookmark.adminUserId,
      imageId: bookmark.imageId,
      bookmarkedAt: bookmark.createdAt,
      image: {
        ...image,
        tags: extractTagNames(image),
        fullPath: this.route.fullUrl('images', image.id),
        albums: (image.albumImages ?? []).map((albumImage: any) => albumImage.album),
        activeShareLinks: image._count?.shareLinks ?? 0,
      },
    };
  }

  private mapUserBookmark(bookmark: any) {
    const user = bookmark.user;

    return {
      id: bookmark.id,
      adminUserId: bookmark.adminUserId,
      userId: bookmark.userId,
      bookmarkedAt: bookmark.createdAt,
      user: {
        ...user,
        totalImages: user._count?.images ?? 0,
        totalAvatars: user._count?.avatars ?? 0,
        totalAlbums: user._count?.albums ?? 0,
      },
    };
  }
}

