import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import {
  extractTagNames,
  extractVideoTagNames,
  normalizeTagNames,
} from '@/modules/tag/tag.utils';
import { RouteHelperService } from '@/utils/route.utils';

export type AdminVideoBookmarksListParams = {
  clientId?: string;
  search?: string;
  page?: number;
  perPage?: number;
};

export type AdminBookmarksListParams = {
  clientId?: string;
  search?: string;
  tags?: string[];
  page?: number;
  perPage?: number;
};

export type AdminCreatorBookmarksListParams = {
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

  async listBookmarks(
    adminUser: AdminJwtPayload,
    params: AdminBookmarksListParams,
  ) {
    const page = Math.max(Number(params.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(params.perPage) || 20, 1), 100);
    const skip = (page - 1) * perPage;
    const now = new Date();

    const where: any = {
      actorId: adminUser.actorId,
      image: buildClientWhere(adminUser, params.clientId),
    };

    if (params.search) {
      where.image.originalName = {
        contains: params.search,
        mode: 'insensitive',
      };
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
        actorId_imageId: {
          actorId: adminUser.actorId,
          imageId,
        },
      },
      create: {
        actorId: adminUser.actorId,
        imageId,
      },
      update: {},
    });

    return this.getBookmarkByAdminAndImage(adminUser.actorId, imageId);
  }

  async bookmarkUser(adminUser: AdminJwtPayload, creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { id: true, clientId: true },
    });

    if (!creator) {
      throw new NotFoundException('Creator not found');
    }

    assertClientAccess(adminUser, creator.clientId);

    const prisma = this.prisma as any;

    await prisma.adminCreatorBookmark.upsert({
      where: {
        actorId_creatorId: {
          actorId: adminUser.actorId,
          creatorId,
        },
      },
      create: {
        actorId: adminUser.actorId,
        creatorId,
      },
      update: {},
    });

    return this.getBookmarkByAdminAndUser(adminUser.actorId, creatorId);
  }

  async removeBookmark(
    adminUser: AdminJwtPayload,
    imageId: string,
  ): Promise<{ removed: number }> {
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
        actorId: adminUser.actorId,
        imageId,
      },
    });

    return { removed: result.count };
  }

  async removeUserBookmark(
    adminUser: AdminJwtPayload,
    creatorId: string,
  ): Promise<{ removed: number }> {
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { id: true, clientId: true },
    });

    if (!creator) {
      throw new NotFoundException('Creator not found');
    }

    assertClientAccess(adminUser, creator.clientId);

    const prisma = this.prisma as any;

    const result = await prisma.adminCreatorBookmark.deleteMany({
      where: {
        actorId: adminUser.actorId,
        creatorId,
      },
    });

    return { removed: result.count };
  }

  private async getBookmarkByAdminAndImage(actorId: string, imageId: string) {
    const prisma = this.prisma as any;

    const bookmark = await prisma.adminImageBookmark.findUnique({
      where: {
        actorId_imageId: {
          actorId,
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

  private async getBookmarkByAdminAndUser(actorId: string, creatorId: string) {
    const prisma = this.prisma as any;

    const bookmark = await prisma.adminCreatorBookmark.findUnique({
      where: {
        actorId_creatorId: {
          actorId,
          creatorId,
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
          creator: { select: { externalId: true, username: true } },
          albumItems: {
            where: { resourceType: 'IMAGE' },
            include: {
              album: {
                select: {
                  id: true,
                  name: true,
                  externalAlbumId: true,
                  isPublic: true,
                },
              },
            },
          },
          _count: {
            select: {
              shareLinks: {
                where: {
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
              },
            },
          },
        },
      },
    };
  }

  private buildUserBookmarkInclude() {
    return {
      creator: {
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
      actorId: bookmark.actorId,
      imageId: bookmark.imageId,
      bookmarkedAt: bookmark.createdAt,
      image: {
        ...image,
        tags: extractTagNames(image),
        fullPath: this.route.fullUrl('images', image.id),
        albums: (image.albumItems ?? []).map(
          (albumItem: any) => albumItem.album,
        ),
        activeShareLinks: image._count?.shareLinks ?? 0,
      },
    };
  }

  async listVideoBookmarks(
    adminUser: AdminJwtPayload,
    params: AdminVideoBookmarksListParams,
  ) {
    const page = Math.max(Number(params.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(params.perPage) || 20, 1), 100);
    const skip = (page - 1) * perPage;

    const where: any = {
      actorId: adminUser.actorId,
      video: buildClientWhere(adminUser, params.clientId),
    };

    if (params.search) {
      where.video.originalName = {
        contains: params.search,
        mode: 'insensitive',
      };
    }

    const prisma = this.prisma as any;

    const [rows, total] = await Promise.all([
      prisma.adminVideoBookmark.findMany({
        where,
        include: this.buildVideoBookmarkInclude(),
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      prisma.adminVideoBookmark.count({ where }),
    ]);

    return {
      data: rows.map((b: any) => this.mapVideoBookmark(b)),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async bookmarkVideo(adminUser: AdminJwtPayload, videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, clientId: true },
    });

    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    const prisma = this.prisma as any;

    await prisma.adminVideoBookmark.upsert({
      where: { actorId_videoId: { actorId: adminUser.actorId, videoId } },
      create: { actorId: adminUser.actorId, videoId },
      update: {},
    });

    return this.getBookmarkByAdminAndVideo(adminUser.actorId, videoId);
  }

  async removeVideoBookmark(
    adminUser: AdminJwtPayload,
    videoId: string,
  ): Promise<{ removed: number }> {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, clientId: true },
    });

    if (!video) throw new NotFoundException('Video not found');
    assertClientAccess(adminUser, video.clientId);

    const prisma = this.prisma as any;
    const result = await prisma.adminVideoBookmark.deleteMany({
      where: { actorId: adminUser.actorId, videoId },
    });

    return { removed: result.count };
  }

  private async getBookmarkByAdminAndVideo(actorId: string, videoId: string) {
    const prisma = this.prisma as any;

    const bookmark = await prisma.adminVideoBookmark.findUnique({
      where: { actorId_videoId: { actorId, videoId } },
      include: this.buildVideoBookmarkInclude(),
    });

    if (!bookmark)
      throw new BadRequestException('Bookmark could not be created');
    return this.mapVideoBookmark(bookmark);
  }

  private buildVideoBookmarkInclude() {
    return {
      video: {
        include: {
          videoTags: { include: { tag: { select: { name: true } } } },
          client: { select: { id: true, name: true, domain: true } },
          creator: { select: { externalId: true, username: true } },
        },
      },
    };
  }

  private mapVideoBookmark(bookmark: any) {
    const video = bookmark.video;
    return {
      id: bookmark.id,
      actorId: bookmark.actorId,
      videoId: bookmark.videoId,
      bookmarkedAt: bookmark.createdAt,
      video: {
        ...video,
        tags: extractVideoTagNames(video),
        fullPath: this.route.fullUrl('admin', 'videos', video.id, 'stream'),
        fullThumbnailUrl: this.route.fullUrl(
          'admin',
          'videos',
          video.id,
          'thumb',
        ),
      },
    };
  }

  private mapUserBookmark(bookmark: any) {
    const creator = bookmark.creator;

    return {
      id: bookmark.id,
      actorId: bookmark.actorId,
      creatorId: bookmark.creatorId,
      bookmarkedAt: bookmark.createdAt,
      creator: {
        ...creator,
        totalImages: creator._count?.images ?? 0,
        totalAvatars: creator._count?.avatars ?? 0,
        totalAlbums: creator._count?.albums ?? 0,
      },
    };
  }
}
