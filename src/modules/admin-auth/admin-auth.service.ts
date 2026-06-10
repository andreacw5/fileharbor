import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { firstValueFrom } from 'rxjs';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
} from './dto/admin-response.dto';
import { AdminJwtPayload, BastionJwtPayload } from './guards/admin-jwt.guard';

interface BastionTokenResponse {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Auth ───────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AdminLoginResponseDto> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');

    const tokens = await this.callBastion<BastionTokenResponse>(
      'POST',
      `${bastionUrl}/auth/login`,
      { email, password, appSlug },
    );

    const decoded = this.jwtService.decode<BastionJwtPayload>(tokens.accessToken);
    if (!decoded?.sub) {
      throw new ServiceUnavailableException('Malformed token from auth service');
    }

    const isSuperAdmin = decoded.role === 'SUPER_ADMIN';
    const adminUser = await this.prisma.adminUser.upsert({
      where: { bastionUserId: decoded.sub },
      create: {
        bastionUserId: decoded.sub,
        email: decoded.email,
        name: decoded.username ?? null,
        active: true,
        allClientsAccess: isSuperAdmin,
        lastLoginAt: new Date(),
      },
      update: {
        email: decoded.email,
        ...(decoded.username && { name: decoded.username }),
        lastLoginAt: new Date(),
      },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`[Admin] Login: bastionUserId=${decoded.sub}`);

    const expiresIn = decoded.exp - decoded.iat;
    const allowedClientIds = adminUser.clientAccess.map((a) => a.clientId);
    const user = this.formatAdminUser(adminUser, decoded.role, allowedClientIds);

    return plainToInstance(
      AdminLoginResponseDto,
      { ...tokens, expiresIn, user },
      { excludeExtraneousValues: true },
    );
  }

  async refresh(refreshToken: string): Promise<AdminRefreshResponseDto> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');

    const tokens = await this.callBastion<BastionTokenResponse>(
      'POST',
      `${bastionUrl}/auth/refresh`,
      { refreshToken, appSlug },
    );

    const decoded = this.jwtService.decode<BastionJwtPayload>(tokens.accessToken);
    const expiresIn = decoded ? decoded.exp - decoded.iat : 900;

    return plainToInstance(
      AdminRefreshResponseDto,
      { ...tokens, expiresIn },
      { excludeExtraneousValues: true },
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    try {
      await this.callBastion('POST', `${bastionUrl}/auth/logout`, { refreshToken });
    } catch {
      // Silently succeed — token may already be revoked
    }
  }

  // ─── Profile ────────────────────────────────────────────────────────────────

  async getProfile(admin: AdminJwtPayload): Promise<AdminUserResponseDto> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { bastionUserId: admin.sub },
      include: { clientAccess: { select: { clientId: true } } },
    });
    if (!adminUser) throw new NotFoundException('Admin user not found');
    return this.formatAdminUser(adminUser, admin.role, adminUser.clientAccess.map((a) => a.clientId));
  }

  async updateProfile(
    admin: AdminJwtPayload,
    data: { name?: string },
  ): Promise<AdminUserResponseDto> {
    const updated = await this.prisma.adminUser.update({
      where: { bastionUserId: admin.sub },
      data: { ...(data.name !== undefined && { name: data.name }) },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`[Admin] Profile updated: bastionUserId=${admin.sub}`);
    return this.formatAdminUser(updated, admin.role, updated.clientAccess.map((a) => a.clientId));
  }

  // ─── Admin User Management ──────────────────────────────────────────────────

  async createAdminUser(
    bastionUserId: string,
    email: string,
    name?: string,
    allClientsAccess = false,
    clientIds: string[] = [],
  ): Promise<AdminUserResponseDto> {
    const existing = await this.prisma.adminUser.findUnique({ where: { bastionUserId } });
    if (existing) throw new ConflictException('Admin user already exists for this Bastion user');

    const adminUser = await this.prisma.adminUser.create({
      data: {
        bastionUserId,
        email,
        name: name ?? null,
        allClientsAccess,
        clientAccess: clientIds.length
          ? { createMany: { data: clientIds.map((clientId) => ({ clientId })) } }
          : undefined,
      },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`[Admin] Created AdminUser: bastionUserId=${bastionUserId}`);
    return this.formatAdminUser(adminUser, 'VIEWER', adminUser.clientAccess.map((a) => a.clientId));
  }

  async setClientAccess(
    adminUserId: string,
    allClientsAccess: boolean,
    clientIds: string[] = [],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.adminClientAccess.deleteMany({ where: { adminUserId } }),
      this.prisma.adminUser.update({
        where: { id: adminUserId },
        data: {
          allClientsAccess,
          clientAccess: clientIds.length
            ? { createMany: { data: clientIds.map((clientId) => ({ clientId })) } }
            : undefined,
        },
      }),
    ]);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private formatAdminUser(
    user: any,
    role: string,
    allowedClientIds: string[],
  ): AdminUserResponseDto {
    return plainToInstance(
      AdminUserResponseDto,
      { ...user, role, allowedClientIds },
      { excludeExtraneousValues: true },
    );
  }

  private async callBastion<T>(method: 'POST', url: string, body: object): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({ method, url, data: body }),
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new UnauthorizedException(error.response?.data?.message ?? 'Invalid credentials');
      }
      this.logger.error(`Bastion call failed: ${method} ${url} → ${status ?? 'network error'}`);
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
  }
}
