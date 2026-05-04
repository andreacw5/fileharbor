import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/modules/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { plainToInstance } from 'class-transformer';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
  AdminClientResponseDto,
  AdminDeleteResponseDto,
  AdminAlbumResponseDto,
  AdminImageResponseDto,
  AdminAvatarResponseDto,
  AdminAddImagesToAlbumResponseDto,
} from './dto/admin-response.dto';
import { AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUpdateClientDto } from './dto/admin-update-client.dto';
import { AdminUpdateAlbumDto } from './dto/admin-update-album.dto';
import { AdminUpdateImageDto } from './dto/admin-update-image.dto';
import { AdminUploadImageDto } from './dto/admin-upload-image.dto';
import { AdminCreateAlbumDto } from './dto/admin-create-album.dto';
import { ImageService } from '@/modules/image/image.service';
import { AvatarService } from '@/modules/avatar/avatar.service';
import { AlbumService } from '@/modules/album/album.service';
import { ClientService } from '@/modules/client/client.service';
import { ImageResponseDto } from '@/modules/image/dto';
import {
  resolveAllowedClients,
  assertClientAccess,
  buildClientWhere,
} from '@/modules/admin/helpers/admin-access.helper';
import { buildImageTagCreateInput, extractTagNames, normalizeTagNames } from '@/modules/tag/tag.utils';

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


  // ─── Clients ─────────────────────────────────────────────────────────────

  async listClients(admin: AdminJwtPayload): Promise<AdminClientResponseDto[]> {
    const allowed = resolveAllowedClients(admin);
    const clients = await this.clientService.listClientsWithStats(allowed);
    return clients.map((c) =>
      plainToInstance(AdminClientResponseDto, c, { excludeExtraneousValues: true }),
    );
  }

  async getClient(clientId: string, admin: AdminJwtPayload): Promise<AdminClientResponseDto> {
    assertClientAccess(admin, clientId);
    const client = await this.clientService.getClientWithStats(clientId);
    if (!client) throw new NotFoundException('Client not found');
    return plainToInstance(AdminClientResponseDto, client, { excludeExtraneousValues: true });
  }

  async updateClient(
    clientId: string,
    dto: AdminUpdateClientDto,
    admin: AdminJwtPayload,
  ): Promise<AdminClientResponseDto> {
    assertClientAccess(admin, clientId);

    const exists = await this.clientService.getClientById(clientId);
    if (!exists) throw new NotFoundException('Client not found');

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.webhookEnabled !== undefined) data.webhookEnabled = dto.webhookEnabled;
    if ('webhookUrl' in dto) data.webhookUrl = dto.webhookUrl ?? null;

    const updated = await this.clientService.updateClientWithStats(clientId, data);
    this.logger.log(`[Admin] Client updated: ${clientId}`);
    return plainToInstance(AdminClientResponseDto, updated, { excludeExtraneousValues: true });
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
    const take = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * take;

    const where: any = buildClientWhere(admin, filters.clientId);
    if (filters.userId) where.user = { id: filters.userId };
    if (filters.albumId) where.albumImages = { some: { albumId: filters.albumId } };
    if (filters.name) where.originalName = { contains: filters.name, mode: 'insensitive' };
    if (filters.tags && filters.tags.length > 0) {
      where.imageTags = {
        some: { tag: { name: { in: normalizeTagNames(filters.tags) } } },
      };
    }

    return this.imageService.findAdminImages(where, { skip, take, page });
  }

  async deleteImage(imageId: string, admin: AdminJwtPayload): Promise<AdminDeleteResponseDto> {
    const image = await this.imageService.getImageById(imageId);
    assertClientAccess(admin, image.clientId);

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
    assertClientAccess(admin, dto.clientId);

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
    const image = await this.imageService.findAdminImageById(imageId);
    if (!image) throw new NotFoundException('Image not found');
    assertClientAccess(admin, image.clientId);

    const apiPrefix = this.config.get('API_PREFIX') || 'v2';
    const baseUrl = this.config.get('BASE_URL') || 'http://localhost:3000';
    const fullPath = `${baseUrl}/${apiPrefix}/images/${image.id}`;

    const albums = image.albumImages.map((ai) => ai.album);
    const activeShareLinks = image._count.shareLinks;

    return plainToInstance(
      AdminImageResponseDto,
      { ...image, tags: extractTagNames(image), fullPath, albums, activeShareLinks },
      { excludeExtraneousValues: true },
    );
  }

  async updateImage(
    imageId: string,
    dto: AdminUpdateImageDto,
    admin: AdminJwtPayload,
  ): Promise<AdminImageResponseDto> {
    const existing = await this.imageService.getImageById(imageId);
    assertClientAccess(admin, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.originalName !== undefined) data.originalName = dto.originalName;
    if (dto.isPrivate !== undefined) data.isPrivate = dto.isPrivate;
    if ('description' in dto) data.description = dto.description ?? null;
    if (dto.tags !== undefined) {
      const imageTagsInput = buildImageTagCreateInput(existing.clientId, dto.tags);
      data.imageTags = {
        deleteMany: {},
        ...(imageTagsInput.length > 0 && { create: imageTagsInput }),
      };
    }

    const updated = await this.imageService.adminUpdateImage(imageId, data);
    this.logger.log(`[Admin] Image updated: ${imageId}`);
    return plainToInstance(
      AdminImageResponseDto,
      { ...updated, tags: extractTagNames(updated) },
      { excludeExtraneousValues: true },
    );
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
    const take = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * take;

    const where: any = buildClientWhere(admin, filters.clientId);
    if (filters.userId) where.user = { externalUserId: filters.userId };

    const { avatars, total } = await this.avatarService.findAdminAvatars(where, { skip, take });

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
    const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(admin, avatar.clientId);

    await this.avatarService.deleteAvatarById(avatarId, avatar.clientId);

    this.logger.log(`[Admin] Avatar deleted: ${avatarId}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Avatar deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  async getAvatar(avatarId: string, admin: AdminJwtPayload): Promise<AdminAvatarResponseDto> {
    const avatar = await this.avatarService.getAvatarById(avatarId);
    if (!avatar) throw new NotFoundException('Avatar not found');
    assertClientAccess(admin, avatar.clientId);

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
    const take = Math.min(filters.perPage || 20, 100);
    const skip = (page - 1) * take;

    const where: any = buildClientWhere(admin, filters.clientId);
    if (filters.userId) where.user = { externalUserId: filters.userId };
    if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
    if (filters.public !== undefined) where.isPublic = filters.public;

    const { albums, total } = await this.albumService.findAdminAlbums(where, { skip, take });

    return {
      data: albums.map((a) => ({ ...a, totalImages: a._count.albumImages, activeTokens: a._count.albumTokens })),
      pagination: { page, perPage: take, total, totalPages: Math.ceil(total / take) },
    };
  }

  async deleteAlbum(albumId: string, admin: AdminJwtPayload): Promise<AdminDeleteResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(albumId);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(admin, album.clientId);

    await this.albumService.forceDeleteAlbum(albumId, album.clientId);

    this.logger.log(`[Admin] Album deleted: ${albumId}`);
    return plainToInstance(
      AdminDeleteResponseDto,
      { success: true, message: 'Album deleted successfully' },
      { excludeExtraneousValues: true },
    );
  }

  async getAlbum(albumId: string, admin: AdminJwtPayload): Promise<AdminAlbumResponseDto> {
    const album = await this.albumService.findAdminAlbumById(albumId);
    if (!album) throw new NotFoundException('Album not found');
    assertClientAccess(admin, album.clientId);

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
    const existing = await this.albumService.getAlbumByIdUnscoped(albumId);
    if (!existing) throw new NotFoundException('Album not found');
    assertClientAccess(admin, existing.clientId);

    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if ('externalAlbumId' in dto) data.externalAlbumId = dto.externalAlbumId ?? null;

    const updated = await this.albumService.adminUpdateAlbum(albumId, data);
    this.logger.log(`[Admin] Album updated: ${albumId}`);

    return plainToInstance(
      AdminAlbumResponseDto,
      { ...updated, totalImages: updated._count.albumImages, activeTokens: updated._count.albumTokens },
      { excludeExtraneousValues: true },
    );
  }

  async adminCreateAlbum(
    dto: AdminCreateAlbumDto,
    admin: AdminJwtPayload,
  ): Promise<AdminAlbumResponseDto> {
    assertClientAccess(admin, dto.clientId);

    const externalUserId = dto.externalUserId || 'system';
    const user = await this.clientService.getOrCreateUser(dto.clientId, externalUserId);

    const album = await this.albumService.createAlbum(dto.clientId, user.id, {
      name: dto.name,
      description: dto.description,
      isPublic: dto.isPublic,
      externalAlbumId: dto.externalAlbumId,
    });

    this.logger.log(`[Admin] Album created: ${album.id} for client: ${dto.clientId}`);

    // Re-fetch with counts for consistent response shape
    return this.getAlbum(album.id, admin);
  }

  async adminAddImagesToAlbum(
    albumId: string,
    imageIds: string[],
    admin: AdminJwtPayload,
  ): Promise<AdminAddImagesToAlbumResponseDto> {
    const album = await this.albumService.getAlbumByIdUnscoped(albumId);
    if (!album) throw new NotFoundException('Album not found');

    assertClientAccess(admin, album.clientId);

    const result = await this.albumService.forceAddImagesToAlbum(albumId, album.clientId, imageIds);

    this.logger.log(`[Admin] Added ${result.images.length} images to album: ${albumId}`);

    return plainToInstance(
      AdminAddImagesToAlbumResponseDto,
      { albumId: result.albumId, images: result.images, count: result.images.length },
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
