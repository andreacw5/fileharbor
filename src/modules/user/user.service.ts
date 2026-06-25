import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { Prisma, User } from '@prisma/client';
import { AdminJwtPayload } from '@/modules/admin-auth/guards/admin-jwt.guard';
import {
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';
import { UpdateUserByExternalIdDto } from './dto/update-user-by-external-id.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { generateAnonymousUsername } from '@/utils/username.generator';
import { RouteHelperService } from '@/utils/route.utils';

/** Reserved external user ID — never expose or mutate this user via API endpoints. */
const SYSTEM_USER_ID = 'system';

@Injectable()
export class UserService {

  private readonly logger = new Logger(UserService.name);

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
    user: any,
    extra: Record<string, unknown> = {},
  ): T {
    return plainToInstance(
      ctor,
      {
        ...user,
        totalImages: user._count?.images,
        totalAvatars: user._count?.avatars,
        totalAlbums: user._count?.albums,
        totalVideos: user._count?.videos,
        ...extra,
      },
      { excludeExtraneousValues: true },
    );
  }

  // ─── API-Key scoped methods ───────────────────────────────────────────────

  /**
   * Finds an existing user or creates a new one for the given client + externalUserId.
   * - If creating and no username is supplied, an anonymous one is auto-generated
   *   (e.g. "Witty Raccoon", "Bold Penguin").
   * - If the user already exists and a username is supplied, it is updated.
   * Returns the raw Prisma User record (not a response DTO).
   */
  async resolveUser(
    clientId: string,
    externalUserId: string,
    username?: string,
  ): Promise<User> {
    this.logger.debug(
      `resolveUser clientId=${clientId} externalUserId=${externalUserId} username=${username ?? '(auto)'}`,
    );

    return this.prisma.user.upsert({
      where: { clientId_externalUserId: { clientId, externalUserId } },
      update: { ...(username ? { username } : {}) },
      create: {
        clientId,
        externalUserId,
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

    const { page, take, skip } = this.buildPagination(filters.page, filters.perPage);

    const where: any = { clientId, externalUserId: { not: SYSTEM_USER_ID } };

    if (filters.search) {
      where.OR = [
        { externalUserId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, albums: true, videos: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    this.logger.debug(`listUsersForClient returned ${users.length}/${total} users`);

    const data = users.map((u) => this.mapUser(UserListResponseDto, u));

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async createUserForClient(
    clientId: string,
    dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    this.logger.log(
      `createUserForClient clientId=${clientId} externalUserId=${dto.externalUserId}`,
    );

    if (dto.externalUserId === SYSTEM_USER_ID) {
      throw new BadRequestException('externalUserId "system" is reserved');
    }

    const existing = await this.prisma.user.findUnique({
      where: {
        clientId_externalUserId: { clientId, externalUserId: dto.externalUserId },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `User with externalUserId "${dto.externalUserId}" already exists for this client`,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        clientId,
        externalUserId: dto.externalUserId,
        username: dto.username || generateAnonymousUsername(),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      },
      include: {
        _count: { select: { images: true, avatars: true, videos: true } },
      },
    });

    this.logger.log(`createUserForClient created user=${user.id} clientId=${clientId}`);

    return this.mapUser(UserResponseDto, user);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

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

    const { page, take, skip } = this.buildPagination(filters.page, filters.perPage);
    const where: any = buildClientWhere(admin, filters.clientId);

    if (filters.search) {
      where.OR = [
        { externalUserId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Exclude system user
    where.externalUserId = { ...(where.externalUserId || {}), not: SYSTEM_USER_ID };

    if (filters.isBookmarked === true) {
      where.adminBookmarks = {
        some: { adminUserId: admin.adminUserId },
      };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, avatars: true, videos: true } },
          client: { select: { id: true, name: true, domain: true } },
          avatars: {
            select: { id: true, userId: true },
            take: 1,
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    let bookmarkedUserIds = new Set<string>();
    if (users.length > 0) {
      if (filters.isBookmarked === true) {
        bookmarkedUserIds = new Set(users.map((u) => u.id));
      } else {
        const bookmarks = await this.prisma.adminUserBookmark.findMany({
          where: {
            adminUserId: admin.adminUserId,
            userId: { in: users.map((u) => u.id) },
          },
          select: { userId: true },
        });
        bookmarkedUserIds = new Set(bookmarks.map((b) => b.userId));
      }
    }

    this.logger.debug(`listUsers returned ${users.length}/${total} users`);

    const data = users.map((u) => {
      const avatarUrl = u.avatars.length > 0 ? this.route.fullUrl('avatars', u.externalUserId) : undefined;
      return this.mapUser(UserListResponseDto, u, {
        isBookmarked: bookmarkedUserIds.has(u.id),
        avatarUrl,
      });
    });

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async getUser(userId: string, admin: AdminJwtPayload): Promise<UserResponseDto> {
    this.logger.log(`getUser called by admin=${admin.sub} userId=${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: { select: { images: true, avatars: true, albums: true, videos: true } },
        client: { select: { id: true, name: true, domain: true } },
        avatars: {
          select: { id: true, userId: true },
          take: 1,
        },
      },
    });

    if (!user) {
      this.logger.warn(`getUser: user not found userId=${userId}`);
      throw new NotFoundException('User not found');
    }

    assertClientAccess(admin, user.clientId);

    const bookmark = await this.prisma.adminUserBookmark.findUnique({
      where: {
        adminUserId_userId: {
          adminUserId: admin.adminUserId,
          userId: user.id,
        },
      },
      select: { id: true },
    });

    this.logger.debug(`getUser: found user=${userId} clientId=${user.clientId}`);

    const avatarUrl = user.avatars.length > 0 ? this.route.fullUrl('avatars', user.externalUserId) : undefined;

    return this.mapUser(UserResponseDto, user, {
      isBookmarked: !!bookmark,
      avatarUrl,
    });
  }

  async createUserAdmin(
    admin: AdminJwtPayload,
    clientId: string,
    dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    this.logger.log(
      `createUserAdmin called by admin=${admin.sub} clientId=${clientId} externalUserId=${dto.externalUserId}`,
    );
    assertClientAccess(admin, clientId);
    return this.createUserForClient(clientId, dto);
  }

  async updateUserAdmin(
    userId: string,
    dto: UpdateUserAdminDto,
    admin: AdminJwtPayload,
  ): Promise<UserResponseDto> {
    this.logger.log(`updateUserAdmin called by admin=${admin.sub} userId=${userId}`);

    if (!dto.externalUserId && !dto.username && !dto.email && !dto.website && !dto.bio) {
      throw new BadRequestException(
        'At least one field between externalUserId, username, email, website, and bio must be provided',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, clientId: true, externalUserId: true },
    });

    if (!user) {
      this.logger.warn(`updateUserAdmin: user not found userId=${userId}`);
      throw new NotFoundException('User not found');
    }

    assertClientAccess(admin, user.clientId);

    if (user.externalUserId === SYSTEM_USER_ID) {
      throw new BadRequestException('System user cannot be updated');
    }

    // Check if new externalUserId conflicts with existing user
    if (dto.externalUserId && dto.externalUserId !== user.externalUserId) {
      const existingUser = await this.prisma.user.findUnique({
        where: {
          clientId_externalUserId: {
            clientId: user.clientId,
            externalUserId: dto.externalUserId,
          },
        },
        select: { id: true },
      });

      if (existingUser) {
        throw new BadRequestException(
          `User with externalUserId "${dto.externalUserId}" already exists for this client`,
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.externalUserId !== undefined ? { externalUserId: dto.externalUserId } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.website !== undefined ? { website: dto.website } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      },
      include: {
        _count: { select: { images: true, avatars: true, albums: true, videos: true } },
        client: { select: { id: true, name: true, domain: true } },
      },
    });

    this.logger.log(
      `updateUserAdmin: updated user=${updated.id} clientId=${updated.clientId}`,
    );

    return this.mapUser(UserResponseDto, updated);
  }

  async updateUserByExternalUserId(
    clientId: string,
    externalUserId: string,
    dto: UpdateUserByExternalIdDto,
  ): Promise<UserResponseDto> {
    this.logger.log(
      `updateUserByExternalUserId called for clientId=${clientId} externalUserId=${externalUserId}`,
    );

    if (!dto.username && !dto.email && !dto.website && !dto.bio) {
      throw new BadRequestException(
        'At least one field between username, email, website, and bio must be provided',
      );
    }

    if (externalUserId === SYSTEM_USER_ID) {
      throw new BadRequestException('System user cannot be updated with this endpoint');
    }

    try {
      const updated = await this.prisma.user.update({
        where: { clientId_externalUserId: { clientId, externalUserId } },
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

      this.logger.log(`updateUserByExternalUserId updated user=${updated.id} clientId=${updated.clientId}`);

      return this.mapUser(UserResponseDto, updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('User not found');
      }
      throw e;
    }
  }
}
