import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/modules/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
  AdminClientResponseDto,
  AdminStatsResponseDto,
  AdminDeleteResponseDto,
  AdminTagsResponseDto,
  AdminAlbumResponseDto,
  AdminImageResponseDto,
  AdminAvatarResponseDto,
  AdminClientUserResponseDto,
  DailyDataPointDto,
  StatsTrendDto,
} from './dto/admin-response.dto';
import { AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUpdateClientDto } from './dto/admin-update-client.dto';
import { AdminUpdateAlbumDto } from './dto/admin-update-album.dto';
import { AdminUpdateImageDto } from './dto/admin-update-image.dto';
import { AdminUploadImageDto } from './dto/admin-upload-image.dto';
import { ImageService } from '@/modules/image/image.service';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { AlbumService } from '@/modules/album/album.service';
import { ClientService } from '@/modules/client/client.service';
import { ImageResponseDto } from '@/modules/image/dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly imageService: ImageService,
    private readonly avatarService: AvatarService,
    private readonly albumService: AlbumService,
    private readonly clientService: ClientService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns the list of allowed clientIds for a given admin payload.
   * SUPER_ADMIN or allClientsAccess=true → null (no restriction).
   * Otherwise → array of allowed IDs (may be empty).
   */
  private resolveAllowedClients(admin: AdminJwtPayload): string[] | null {
    if (admin.role === 'SUPER_ADMIN' || admin.allClientsAccess) return null;
    return admin.allowedClientIds;
  }

  /**
   * Asserts that `clientId` is in the admin's allowed list (or unrestricted).
   */
  private assertClientAccess(admin: AdminJwtPayload, clientId: string): void {
    const allowed = this.resolveAllowedClients(admin);
    if (allowed !== null && !allowed.includes(clientId)) {
      throw new ForbiddenException('You do not have access to this client');
    }
  }

  /** Build Prisma WHERE clause that scopes by allowed clients */
  private buildClientWhere(
    admin: AdminJwtPayload,
    extraClientId?: string,
  ): { clientId?: string | { in: string[] } } {
    if (extraClientId) {
      this.assertClientAccess(admin, extraClientId);
      return { clientId: extraClientId };
    }
    const allowed = this.resolveAllowedClients(admin);
    if (allowed === null) return {};
    return { clientId: { in: allowed } };
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  /** Generate a signed access token for the given admin payload */
  private signAccessToken(payload: Omit<AdminJwtPayload, never>): { token: string; expiresIn: number } {
    const expiresIn = this.config.get<string>('jwtAdminExpiresIn') || '15m';
    const token = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwtAdminSecret'),
      expiresIn: expiresIn as any,
    });
    // Parse seconds from strings like '15m', '2h', '1d'
    const seconds = this.parseExpiresInToSeconds(expiresIn);
    return { token, expiresIn: seconds };
  }

  /** Create and persist a refresh token, returns the raw (unhashed) token */
  private async createRefreshToken(adminUserId: string): Promise<string> {
    const rawToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const days = this.config.get<number>('jwtAdminRefreshExpiresInDays') || 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.adminRefreshToken.create({
      data: { adminUserId, tokenHash, expiresAt },
    });

    return rawToken;
  }

  /** Convert NestJS/jsonwebtoken expiresIn string to seconds */
  private parseExpiresInToSeconds(value: string): number {
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // default 15m
    const n = parseInt(match[1], 10);
    const unit = match[2];
    return unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400;
  }

  async login(email: string, password: string): Promise<AdminLoginResponseDto> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { email },
      include: { clientAccess: { select: { clientId: true } } },
    });

    if (!adminUser || !adminUser.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, adminUser.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.adminUser.update({
      where: { id: adminUser.id },
      data: { lastLoginAt: new Date() },
    });

    const allowedClientIds = adminUser.clientAccess.map((a) => a.clientId);

    const jwtPayload: Omit<AdminJwtPayload, never> = {
      sub: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      allClientsAccess: adminUser.allClientsAccess,
      allowedClientIds,
    };

    const { token: accessToken, expiresIn } = this.signAccessToken(jwtPayload);
    const refreshToken = await this.createRefreshToken(adminUser.id);

    const userDto = this.formatAdminUser(adminUser, allowedClientIds);

    return plainToInstance(
      AdminLoginResponseDto,
      { accessToken, refreshToken, expiresIn, user: userDto },
      { excludeExtraneousValues: true },
    );
  }

  async refresh(rawRefreshToken: string): Promise<AdminRefreshResponseDto> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const stored = await this.prisma.adminRefreshToken.findUnique({
      where: { tokenHash },
      include: {
        adminUser: { include: { clientAccess: { select: { clientId: true } } } },
      },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!stored.adminUser.active) {
      throw new UnauthorizedException('Admin account is disabled');
    }

    // Revoke old token (rotation)
    await this.prisma.adminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const allowedClientIds = stored.adminUser.clientAccess.map((a) => a.clientId);

    const jwtPayload: Omit<AdminJwtPayload, never> = {
      sub: stored.adminUser.id,
      email: stored.adminUser.email,
      role: stored.adminUser.role,
      allClientsAccess: stored.adminUser.allClientsAccess,
      allowedClientIds,
    };

    const { token: accessToken, expiresIn } = this.signAccessToken(jwtPayload);
    const newRefreshToken = await this.createRefreshToken(stored.adminUser.id);

    this.logger.log(`[Admin] Token refreshed for user: ${stored.adminUser.email}`);

    return plainToInstance(
      AdminRefreshResponseDto,
      { accessToken, refreshToken: newRefreshToken, expiresIn },
      { excludeExtraneousValues: true },
    );
  }

  async logout(rawRefreshToken: string): Promise<{ message: string }> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const stored = await this.prisma.adminRefreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt) {
      // Silently succeed — token already invalid
      return { message: 'Logged out successfully' };
    }

    await this.prisma.adminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`[Admin] Logout for adminUserId: ${stored.adminUserId}`);
    return { message: 'Logged out successfully' };
  }


  // ─── Profile ────────────────────────────────────────────────────────────────

  async getProfile(admin: AdminJwtPayload): Promise<AdminUserResponseDto> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: admin.sub },
      include: { clientAccess: { select: { clientId: true } } },
    });
    if (!adminUser) throw new NotFoundException('Admin user not found');
    return this.formatAdminUser(adminUser, adminUser.clientAccess.map((a) => a.clientId));
  }

  async updateProfile(
    admin: AdminJwtPayload,
    data: { name?: string; email?: string },
  ): Promise<AdminUserResponseDto> {
    if (data.email) {
      const existing = await this.prisma.adminUser.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== admin.sub) {
        throw new ConflictException('Email already in use');
      }
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: admin.sub },
      data: { ...(data.name !== undefined && { name: data.name }), ...(data.email && { email: data.email }) },
      include: { clientAccess: { select: { clientId: true } } },
    });

    return this.formatAdminUser(updated, updated.clientAccess.map((a) => a.clientId));
  }

  async changePassword(
    admin: AdminJwtPayload,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const adminUser = await this.prisma.adminUser.findUnique({ where: { id: admin.sub } });
    if (!adminUser) throw new NotFoundException('Admin user not found');

    const isValid = await bcrypt.compare(currentPassword, adminUser.passwordHash);
    if (!isValid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.adminUser.update({ where: { id: admin.sub }, data: { passwordHash } });

    return { message: 'Password changed successfully' };
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  async getGlobalStats(admin: AdminJwtPayload): Promise<AdminStatsResponseDto> {
    const clientWhere = this.buildClientWhere(admin);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const clientWhere7d = { ...clientWhere, createdAt: { gte: sevenDaysAgo } };

    const [
      totalClients,
      totalImages,
      totalAvatars,
      totalAlbums,
      totalUsers,
      storageAgg,
      newImages,
      newAvatars,
      newAlbums,
      newUsers,
      newStorageAgg,
    ] = await Promise.all([
      this.prisma.client.count(
        Object.keys(clientWhere).length
          ? { where: { id: (clientWhere as any).clientId } }
          : undefined,
      ),
      this.prisma.image.count({ where: clientWhere }),
      this.prisma.avatar.count({ where: clientWhere }),
      this.prisma.album.count({ where: clientWhere }),
      this.prisma.user.count({ where: clientWhere }),
      this.prisma.image.aggregate({ where: clientWhere, _sum: { size: true } }),
      this.prisma.image.count({ where: clientWhere7d }),
      this.prisma.avatar.count({ where: clientWhere7d }),
      this.prisma.album.count({ where: clientWhere7d }),
      this.prisma.user.count({ where: clientWhere7d }),
      this.prisma.image.aggregate({ where: clientWhere7d, _sum: { size: true } }),
    ]);

    // Build daily chart data for the last 7 days
    const dailyChart = await this.buildDailyChart(clientWhere, sevenDaysAgo);

    const last7Days = plainToInstance(
      StatsTrendDto,
      { newImages, newAvatars, newAlbums, newUsers, newStorage: newStorageAgg._sum.size || 0 },
      { excludeExtraneousValues: true },
    );

    return plainToInstance(
      AdminStatsResponseDto,
      {
        totalClients,
        totalImages,
        totalAvatars,
        totalAlbums,
        totalUsers,
        totalStorage: storageAgg._sum.size || 0,
        last7Days,
        dailyChart,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Build per-day counts for images, avatars, albums and users
   * for the 7-day window starting at `from`.
   */
  private async buildDailyChart(
    clientWhere: object,
    from: Date,
  ): Promise<DailyDataPointDto[]> {
    // Generate the 7 day labels
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }

    const to = new Date(from);
    to.setDate(to.getDate() + 7);

    const timeWhere = { ...clientWhere, createdAt: { gte: from, lt: to } };

    const [images, avatars, albums] = await Promise.all([
      this.prisma.image.findMany({ where: timeWhere, select: { createdAt: true } }),
      this.prisma.avatar.findMany({ where: timeWhere, select: { createdAt: true } }),
      this.prisma.album.findMany({ where: timeWhere, select: { createdAt: true } }),
    ]);

    const countByDay = (records: { createdAt: Date }[], date: string) =>
      records.filter((r) => r.createdAt.toISOString().slice(0, 10) === date).length;

    return days.map((date) =>
      plainToInstance(
        DailyDataPointDto,
        {
          date,
          images: countByDay(images, date),
          avatars: countByDay(avatars, date),
          albums: countByDay(albums, date),
        },
        { excludeExtraneousValues: true },
      ),
    );
  }

  // ─── Clients ─────────────────────────────────────────────────────────────

  async listClients(admin: AdminJwtPayload): Promise<AdminClientResponseDto[]> {
    const allowed = this.resolveAllowedClients(admin);
    const where = allowed !== null ? { id: { in: allowed } } : {};

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { images: true, avatars: true, albums: true } },
      },
    });

    const storagePerClient = await this.prisma.image.groupBy({
      by: ['clientId'],
      where: allowed !== null ? { clientId: { in: allowed } } : undefined,
      _sum: { size: true },
    });

    const storageMap = new Map(
      storagePerClient.map((s) => [s.clientId, s._sum.size || 0]),
    );

    return clients.map((c) =>
      plainToInstance(
        AdminClientResponseDto,
        {
          ...c,
          totalImages: c._count.images,
          totalAvatars: c._count.avatars,
          totalAlbums: c._count.albums,
          totalStorage: storageMap.get(c.id) || 0,
        },
        { excludeExtraneousValues: true },
      ),
    );
  }

  async getClient(clientId: string, admin: AdminJwtPayload): Promise<AdminClientResponseDto> {
    this.assertClientAccess(admin, clientId);

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: { _count: { select: { images: true, avatars: true, albums: true } } },
    });

    if (!client) throw new NotFoundException('Client not found');

    const storageAgg = await this.prisma.image.aggregate({
      where: { clientId },
      _sum: { size: true },
    });

    return plainToInstance(
      AdminClientResponseDto,
      {
        ...client,
        totalImages: client._count.images,
        totalAvatars: client._count.avatars,
        totalAlbums: client._count.albums,
        totalStorage: storageAgg._sum.size || 0,
      },
      { excludeExtraneousValues: true },
    );
  }

  async updateClient(
    clientId: string,
    dto: AdminUpdateClientDto,
    admin: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    this.assertClientAccess(admin, clientId);

    const exists = await this.clientService.getClientById(clientId);
    if (!exists) throw new NotFoundException('Client not found');

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.webhookEnabled !== undefined) data.webhookEnabled = dto.webhookEnabled;
    if ('webhookUrl' in dto) data.webhookUrl = dto.webhookUrl ?? null;

    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data,
      include: { _count: { select: { images: true, avatars: true, albums: true } } },
    });

    const storageAgg = await this.prisma.image.aggregate({
      where: { clientId },
      _sum: { size: true },
    });

    this.logger.log(`[Admin] Client updated: ${clientId}`);

    return plainToInstance(
      AdminClientResponseDto,
      {
        ...updated,
        totalImages: updated._count.images,
        totalAvatars: updated._count.avatars,
        totalAlbums: updated._count.albums,
        totalStorage: storageAgg._sum.size || 0,
      },
      { excludeExtraneousValues: true },
    );
  }

  // ─── Images ───────────────────────────────────────────────────────────────

  async listImages(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      userId?: string;
      albumId?: string;
      name?: string;
      tags?: string[];
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const take = Math.min(perPage, 100);
    const skip = (page - 1) * take;
    const where: any = this.buildClientWhere(admin, filters.clientId);

    if (filters.userId) {
      where.user = { externalUserId: filters.userId };
    }
    if (filters.albumId) {
      where.albumImages = { some: { albumId: filters.albumId } };
    }
    if (filters.name) {
      where.originalName = { contains: filters.name, mode: 'insensitive' };
    }
    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    const [images, total] = await Promise.all([
      this.prisma.image.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { externalUserId: true, username: true } },
          client: { select: { name: true, domain: true } },
        },
      }),
      this.prisma.image.count({ where }),
    ]);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';

    const data = images.map((image) => {
      const fullPath = `${baseUrl}/${apiPrefix}/images/${image.id}`;
      return { ...image, fullPath };
    });

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async deleteImage(imageId: string, admin: AdminJwtPayload): Promise<AdminDeleteResponseDto> {
    const image = await this.prisma.image.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Image not found');

    this.assertClientAccess(admin, image.clientId);

    await this.imageService.deleteImage(imageId, image.clientId);

    this.logger.log(`[Admin] Image deleted: ${imageId}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Image deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  async uploadImage(
    file: Express.Multer.File,
    dto: AdminUploadImageDto,
    admin: AdminJwtPayload,
  ): Promise<ImageResponseDto> {
    this.assertClientAccess(admin, dto.clientId);

    this.logger.log(
      `[Admin] Image upload - Client: ${dto.clientId}, User: ${dto.externalUserId || 'system'}, File: ${file.originalname}`,
    );

    return this.imageService.uploadImage(
      dto.clientId,
      dto.externalUserId,
      file,
      dto.albumId,
      dto.tags,
      dto.description,
      dto.isPrivate,
    );
  }

  async getImage(imageId: string, admin: AdminJwtPayload): Promise<AdminImageResponseDto> {
    const now = new Date();
    const image = await this.prisma.image.findUnique({
      where: { id: imageId },
      include: {
        user: { select: { externalUserId: true, username: true } },
        albumImages: {
          include: {
            album: { select: { id: true, name: true, externalAlbumId: true, isPublic: true } },
          },
        },
        _count: {
          select: {
            shareLinks: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    });

    if (!image) throw new NotFoundException('Image not found');
    this.assertClientAccess(admin, image.clientId);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    const fullPath = `${baseUrl}/${apiPrefix}/images/${image.id}`;

    const albums = image.albumImages.map((ai) => ai.album);
    const activeShareLinks = image._count.shareLinks;

    return plainToInstance(
      AdminImageResponseDto,
      { ...image, fullPath, albums, activeShareLinks },
      { excludeExtraneousValues: true },
    );
  }

  async updateImage(
    imageId: string,
    dto: AdminUpdateImageDto,
    admin: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const image = await this.prisma.image.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Image not found');
    this.assertClientAccess(admin, image.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if ('description' in dto) data.description = dto.description ?? null;

    const updated = await this.prisma.image.update({
      where: { id: imageId },
      data,
      include: { user: { select: { externalUserId: true, username: true } } },
    });

    this.logger.log(`[Admin] Image updated: ${imageId}`);
    return plainToInstance(AdminImageResponseDto, updated, { excludeExtraneousValues: true });
  }

  // ─── Avatars ──────────────────────────────────────────────────────────────

  async listAvatars(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      userId?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const take = Math.min(perPage, 100);
    const skip = (page - 1) * take;
    const where: any = this.buildClientWhere(admin, filters.clientId);

    if (filters.userId) {
      where.user = { externalUserId: filters.userId };
    }

    const [avatars, total] = await Promise.all([
      this.prisma.avatar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { externalUserId: true, username: true } },
          client: { select: { name: true, domain: true } },
        },
      }),
      this.prisma.avatar.count({ where }),
    ]);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';

    const data = avatars.map((avatar) => {
      const externalUserId = avatar.user?.externalUserId;
      const fullPath = externalUserId ? `${baseUrl}/${apiPrefix}/avatars/${externalUserId}` : null;
      return { ...avatar, fullPath };
    });

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async deleteAvatar(avatarId: string, admin: AdminJwtPayload): Promise<AdminDeleteResponseDto> {
    const avatar = await this.prisma.avatar.findUnique({ where: { id: avatarId } });
    if (!avatar) throw new NotFoundException('Avatar not found');

    this.assertClientAccess(admin, avatar.clientId);

    await this.avatarService.deleteAvatarById(avatarId, avatar.clientId);

    this.logger.log(`[Admin] Avatar deleted: ${avatarId}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Avatar deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  async getAvatar(avatarId: string, admin: AdminJwtPayload): Promise<AdminAvatarResponseDto> {
    const avatar = await this.prisma.avatar.findUnique({
      where: { id: avatarId },
      include: { user: { select: { externalUserId: true, username: true } } },
    });

    if (!avatar) throw new NotFoundException('Avatar not found');
    this.assertClientAccess(admin, avatar.clientId);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    const externalUserId = avatar.user?.externalUserId;
    const fullPath = externalUserId ? `${baseUrl}/${apiPrefix}/avatars/${externalUserId}` : null;

    return plainToInstance(AdminAvatarResponseDto, { ...avatar, fullPath }, { excludeExtraneousValues: true });
  }

  // ─── Albums ───────────────────────────────────────────────────────────────

  async listAlbums(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      userId?: string;
      search?: string;
      public?: boolean;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const take = Math.min(perPage, 100);
    const skip = (page - 1) * take;
    const where: any = this.buildClientWhere(admin, filters.clientId);

    if (filters.userId) {
      where.user = { externalUserId: filters.userId };
    }
    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }
    if (filters.public !== undefined) {
      where.isPublic = filters.public;
    }

    const now = new Date();
    const activeTokensWhere = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const [albums, total] = await Promise.all([
      this.prisma.album.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { externalUserId: true, username: true } },
          client: { select: { name: true, domain: true } },
          _count: { select: { albumImages: true, albumTokens: { where: activeTokensWhere } } },
        },
      }),
      this.prisma.album.count({ where }),
    ]);

    return {
      data: albums.map((a) => ({ ...a, totalImages: a._count.albumImages, activeTokens: a._count.albumTokens })),
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async deleteAlbum(albumId: string, admin: AdminJwtPayload): Promise<AdminDeleteResponseDto> {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');

    this.assertClientAccess(admin, album.clientId);

    await this.albumService.forceDeleteAlbum(albumId, album.clientId);

    this.logger.log(`[Admin] Album deleted: ${albumId}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Album deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  async getAlbum(albumId: string, admin: AdminJwtPayload): Promise<AdminAlbumResponseDto> {
    const now = new Date();
    const album = await this.prisma.album.findUnique({
      where: { id: albumId },
      include: {
        user: { select: { externalUserId: true, username: true } },
        _count: {
          select: {
            albumImages: true,
            albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    });

    if (!album) throw new NotFoundException('Album not found');

    this.assertClientAccess(admin, album.clientId);

    return plainToInstance(
      AdminAlbumResponseDto,
      { ...album, totalImages: album._count.albumImages, activeTokens: album._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  async updateAlbum(
    albumId: string,
    dto: AdminUpdateAlbumDto,
    admin: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album) throw new NotFoundException('Album not found');

    this.assertClientAccess(admin, album.clientId);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if ('externalAlbumId' in dto) data.externalAlbumId = dto.externalAlbumId ?? null;

    const now = new Date();
    const updated = await this.prisma.album.update({
      where: { id: albumId },
      data,
      include: {
        user: { select: { externalUserId: true, username: true } },
        _count: {
          select: {
            albumImages: true,
            albumTokens: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    });

    this.logger.log(`[Admin] Album updated: ${albumId}`);

    return plainToInstance(
      AdminAlbumResponseDto,
      { ...updated, totalImages: updated._count.albumImages, activeTokens: updated._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async listUsers(
    admin: AdminJwtPayload,
    filters: {
      clientId?: string;
      search?: string;
      page?: number;
      perPage?: number;
    } = {},
  ) {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;
    const take = Math.min(perPage, 100);
    const skip = (page - 1) * take;
    const where: any = this.buildClientWhere(admin, filters.clientId);

    if (filters.search) {
      where.OR = [
        { externalUserId: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Exclude system user
    where.externalUserId = { ...(where.externalUserId || {}), not: 'system' };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { images: true, avatars: true } },
          client: { select: { id: true, name: true, domain: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = users.map((u) =>
      plainToInstance(
        AdminClientUserResponseDto,
        {
          ...u,
          totalImages: u._count.images,
          totalAvatars: u._count.avatars,
        },
        { excludeExtraneousValues: true },
      ),
    );

    return {
      data,
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────

  /**
   * Returns distinct tags used across images, optionally scoped by clientId
   * and filtered by a search string. Uses a raw SQL `unnest` for efficiency —
   * no full table scan in application memory.
   */
  async listTags(
    admin: AdminJwtPayload,
    filters: { clientId?: string; search?: string; limit?: number } = {},
  ): Promise<AdminTagsResponseDto> {
    const limit = Math.min(filters.limit || 200, 500);

    // Build the client restriction
    let clientConstraint: Prisma.Sql;
    if (filters.clientId) {
      this.assertClientAccess(admin, filters.clientId);
      clientConstraint = Prisma.sql`"clientId" = ${filters.clientId}`;
    } else {
      const allowed = this.resolveAllowedClients(admin);
      if (allowed !== null) {
        clientConstraint = Prisma.sql`"clientId" = ANY(${allowed}::text[])`;
      } else {
        clientConstraint = Prisma.sql`TRUE`;
      }
    }

    const searchConstraint = filters.search
      ? Prisma.sql`AND tag ILIKE ${'%' + filters.search + '%'}`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT tag FROM (
        SELECT DISTINCT unnest(tags) AS tag
        FROM "images"
        WHERE ${clientConstraint}
          AND tags IS NOT NULL
          AND array_length(tags, 1) > 0
      ) sub
      WHERE TRUE ${searchConstraint}
      ORDER BY tag
      LIMIT ${limit}
    `;

    const tags = rows.map((r) => r.tag);

    return plainToInstance(
      AdminTagsResponseDto,
      { tags, total: tags.length },
      { excludeExtraneousValues: true },
    );
  }

  // ─── Formatter ────────────────────────────────────────────────────────────

  private formatAdminUser(
    user: any,
    allowedClientIds: string[],
  ): AdminUserResponseDto {
    return plainToInstance(
      AdminUserResponseDto,
      { ...user, allowedClientIds },
      { excludeExtraneousValues: true },
    );
  }
}
