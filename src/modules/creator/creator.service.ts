import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { Prisma, Creator } from '@prisma/client';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import {
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import {
  CreatorListResponseDto,
  CreatorResponseDto,
} from './dto/creator-response.dto';
import { UpdateCreatorByExternalIdDto } from './dto/update-creator-by-external-id.dto';
import { UpdateCreatorAdminDto } from './dto/update-creator-admin.dto';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { generateAnonymousUsername } from '@/utils/username.generator';
import { RouteHelperService } from '@/utils/route.utils';

/** Reserved external creator ID — never expose or mutate this creator via API endpoints. */
const SYSTEM_USER_ID = 'system';

@Injectable()
export class CreatorService {
  private readonly logger = new Logger(CreatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly route: RouteHelperService,
  ) {}

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** Normalises page/perPage into skip/take with a hard cap of 100 per page. */
  private buildPagination(page?: number, perPage?: number) {
    const p = page || 1;
    const take = Math.min(perPage || 20, 100);
    return { page: p, take, skip: (p - 1) * take };
  }

  /**
   * Flattens Prisma `_count` relations and any extra fields onto the raw record,
   * then transforms the result into the given response DTO class.
   */
  private mapUser<T extends object>(
    ctor: new (...args: any[]) => T,
    creator: any,
    extra: Record<string, unknown> = {},
  ): T {
    return plainToInstance(
      ctor,
      {
        ...creator,
        totalImages: creator._count?.images,
        totalAvatars: creator._count?.avatars,
        totalAlbums: creator._count?.albums,
        totalVideos: creator._count?.videos,
        ...extra,
      },
      { excludeExtraneousValues: true },
    );
  }

  // ─── API-Key scoped methods ───────────────────────────────────────────────

  /**
   * Finds an existing creator or creates a new one for the given client + externalId.
   * - If creating and no username is supplied, an anonymous one is auto-generated
   *   (e.g. "Witty Raccoon", "Bold Penguin").
   * - If the creator already exists and a username is supplied, it is updated.
   * Returns the raw Prisma Creator record (not a response DTO).
   */
  async resolveUser(
    clientId: string,
    externalId: string,
    username?: string,
  ): Promise<Creator> {
    this.logger.debug(
      `resolveUser clientId=${clientId} externalId=${externalId} username=${username ?? '(auto)'}`,
    );

    return this.prisma.creator.upsert({
      where: { clientId_externalId: { clientId, externalId } },
      update: { ...(username ? { username } : {}) },
      create: {
        clientId,
        externalId,
        username: username || generateAnonymousUsername(),
      },
    });
  }

  async listUsersForClient(
    clientId: string,
    filters: { search?: string; page?: number; perPage?: number } = {},
  ) {
    this.logger.log(
      `listUsersForClient clientId=${clientId} search="${filters.search ?? ''}" page=${filters.page ?? 1}`,
    );

    const { page, take, skip } = this.buildPagination(
      filters.page,
      filters.perPage,
    );

    const where: any = { clientId, externalId: { not: SYSTEM_USER_ID } };

    if (filters.search) {
      where.OR = [
        { externalId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [creators, total] = await Promise.all([
      this.prisma.creator.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, albums: true, videos: true } },
        },
      }),
      this.prisma.creator.count({ where }),
    ]);

    this.logger.debug(
      `listUsersForClient returned ${creators.length}/${total} creators`,
    );

    const data = creators.map((u) => this.mapUser(CreatorListResponseDto, u));

    return {
      data,
      pagination: {
        page,
        perPage: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async createUserForClient(
    clientId: string,
    dto: CreateCreatorDto,
  ): Promise<CreatorResponseDto> {
    this.logger.log(
      `createUserForClient clientId=${clientId} externalId=${dto.externalId}`,
    );

    if (dto.externalId === SYSTEM_USER_ID) {
      throw new BadRequestException('externalId "system" is reserved');
    }

    const existing = await this.prisma.creator.findUnique({
      where: {
        clientId_externalId: {
          clientId,
          externalId: dto.externalId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `Creator with externalId "${dto.externalId}" already exists for this client`,
      );
    }

    const creator = await this.prisma.creator.create({
      data: {
        clientId,
        externalId: dto.externalId,
        username: dto.username || generateAnonymousUsername(),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      },
      include: {
        _count: { select: { images: true, avatars: true, videos: true } },
      },
    });

    this.logger.log(
      `createUserForClient created creator=${creator.id} clientId=${clientId}`,
    );

    return this.mapUser(CreatorResponseDto, creator);
  }

  // ─── Creators ────────────────────────────────────────────────────────────────

  async listUsers(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      search?: string;
      isBookmarked?: boolean;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    this.logger.log(
      `listUsers called by admin=${admin.sub} clientId=${filters.clientId ?? 'all'} search="${filters.search ?? ''}" isBookmarked=${filters.isBookmarked === true} page=${filters.page ?? 1}`,
    );

    const { page, take, skip } = this.buildPagination(
      filters.page,
      filters.perPage,
    );
    const where: any = buildClientWhere(admin, filters.clientId);

    if (filters.search) {
      where.OR = [
        { externalId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Exclude system creator
    where.externalId = {
      ...(where.externalId || {}),
      not: SYSTEM_USER_ID,
    };

    if (filters.isBookmarked === true) {
      where.adminBookmarks = {
        some: { actorId: admin.actorId },
      };
    }

    const [creators, total] = await Promise.all([
      this.prisma.creator.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, avatars: true, videos: true } },
          client: { select: { id: true, name: true, domain: true } },
          avatars: {
            select: { id: true, creatorId: true },
            take: 1,
          },
        },
      }),
      this.prisma.creator.count({ where }),
    ]);

    let bookmarkedCreatorExternalIds = new Set<string>();
    if (creators.length > 0) {
      if (filters.isBookmarked === true) {
        bookmarkedCreatorExternalIds = new Set(creators.map((u) => u.id));
      } else {
        const bookmarks = await this.prisma.adminCreatorBookmark.findMany({
          where: {
            actorId: admin.actorId,
            creatorId: { in: creators.map((u) => u.id) },
          },
          select: { creatorId: true },
        });
        bookmarkedCreatorExternalIds = new Set(
          bookmarks.map((b) => b.creatorId),
        );
      }
    }

    this.logger.debug(
      `listUsers returned ${creators.length}/${total} creators`,
    );

    const data = creators.map((u) => {
      const avatarUrl =
        u.avatars.length > 0
          ? this.route.fullUrl('avatars', u.externalId)
          : undefined;
      return this.mapUser(CreatorListResponseDto, u, {
        isBookmarked: bookmarkedCreatorExternalIds.has(u.id),
        avatarUrl,
      });
    });

    return {
      data,
      pagination: {
        page,
        perPage: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async getUser(
    creatorId: string,
    admin: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    this.logger.log(
      `getUser called by admin=${admin.sub} creatorId=${creatorId}`,
    );

    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      include: {
        _count: {
          select: { images: true, avatars: true, albums: true, videos: true },
        },
        client: { select: { id: true, name: true, domain: true } },
        avatars: {
          select: { id: true, creatorId: true },
          take: 1,
        },
      },
    });

    if (!creator) {
      this.logger.warn(`getUser: creator not found creatorId=${creatorId}`);
      throw new NotFoundException('Creator not found');
    }

    assertClientAccess(admin, creator.clientId);

    const bookmark = await this.prisma.adminCreatorBookmark.findUnique({
      where: {
        actorId_creatorId: {
          actorId: admin.actorId,
          creatorId: creator.id,
        },
      },
      select: { id: true },
    });

    this.logger.debug(
      `getUser: found creator=${creatorId} clientId=${creator.clientId}`,
    );

    const avatarUrl =
      creator.avatars.length > 0
        ? this.route.fullUrl('avatars', creator.externalId)
        : undefined;

    return this.mapUser(CreatorResponseDto, creator, {
      isBookmarked: !!bookmark,
      avatarUrl,
    });
  }

  async createUserAdmin(
    admin: AdminJwtPayload,
    clientId: string,
    dto: CreateCreatorDto,
  ): Promise<CreatorResponseDto> {
    this.logger.log(
      `createUserAdmin called by admin=${admin.sub} clientId=${clientId} externalId=${dto.externalId}`,
    );
    assertClientAccess(admin, clientId);
    return this.createUserForClient(clientId, dto);
  }

  async updateUserAdmin(
    creatorId: string,
    dto: UpdateCreatorAdminDto,
    admin: AdminJwtPayload,
  ): Promise<CreatorResponseDto> {
    this.logger.log(
      `updateUserAdmin called by admin=${admin.sub} creatorId=${creatorId}`,
    );

    if (
      !dto.externalId &&
      !dto.username &&
      !dto.email &&
      !dto.website &&
      !dto.bio
    ) {
      throw new BadRequestException(
        'At least one field between externalId, username, email, website, and bio must be provided',
      );
    }

    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { id: true, clientId: true, externalId: true },
    });

    if (!creator) {
      this.logger.warn(
        `updateUserAdmin: creator not found creatorId=${creatorId}`,
      );
      throw new NotFoundException('Creator not found');
    }

    assertClientAccess(admin, creator.clientId);

    if (creator.externalId === SYSTEM_USER_ID) {
      throw new BadRequestException('System creator cannot be updated');
    }

    // Check if new externalId conflicts with existing creator
    if (dto.externalId && dto.externalId !== creator.externalId) {
      const existingCreator = await this.prisma.creator.findUnique({
        where: {
          clientId_externalId: {
            clientId: creator.clientId,
            externalId: dto.externalId,
          },
        },
        select: { id: true },
      });

      if (existingCreator) {
        throw new BadRequestException(
          `Creator with externalId "${dto.externalId}" already exists for this client`,
        );
      }
    }

    const updated = await this.prisma.creator.update({
      where: { id: creatorId },
      data: {
        ...(dto.externalId !== undefined ? { externalId: dto.externalId } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      },
      include: {
        _count: {
          select: { images: true, avatars: true, albums: true, videos: true },
        },
        client: { select: { id: true, name: true, domain: true } },
      },
    });

    this.logger.log(
      `updateUserAdmin: updated creator=${updated.id} clientId=${updated.clientId}`,
    );

    return this.mapUser(CreatorResponseDto, updated);
  }

  async updateUserByExternalId(
    clientId: string,
    externalId: string,
    dto: UpdateCreatorByExternalIdDto,
  ): Promise<CreatorResponseDto> {
    this.logger.log(
      `updateUserByExternalId called for clientId=${clientId} externalId=${externalId}`,
    );

    if (!dto.username && !dto.email && !dto.website && !dto.bio) {
      throw new BadRequestException(
        'At least one field between username, email, website, and bio must be provided',
      );
    }

    if (externalId === SYSTEM_USER_ID) {
      throw new BadRequestException(
        'System creator cannot be updated with this endpoint',
      );
    }

    try {
      const updated = await this.prisma.creator.update({
        where: { clientId_externalId: { clientId, externalId } },
        data: {
          ...(dto.username !== undefined ? { username: dto.username } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.website !== undefined ? { website: dto.website } : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        },
        include: {
          _count: { select: { images: true, avatars: true, albums: true } },
          client: { select: { id: true, name: true, domain: true } },
        },
      });

      this.logger.log(
        `updateUserByExternalId updated creator=${updated.id} clientId=${updated.clientId}`,
      );

      return this.mapUser(CreatorResponseDto, updated);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Creator not found');
      }
      throw e;
    }
  }
}
