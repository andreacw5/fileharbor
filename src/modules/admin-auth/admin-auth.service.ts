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

  async exchange(code: string): Promise<AdminLoginResponseDto> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');
    const tokens = await this.callBastion<BastionTokenResponse>(
      'POST', `${bastionUrl}/auth/exchange`, { code, appSlug },
    );
    return this.buildLoginResponse(tokens, '[Admin] OAuth exchange');
  }

  async login(email: string, password: string, tenantSlug?: string): Promise<AdminLoginResponseDto> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');
    const resolvedTenantSlug = tenantSlug || this.config.get<string>('bastionTenantSlug');
    const tokens = await this.callBastion<BastionTokenResponse>(
      'POST', `${bastionUrl}/auth/login`, { email, password, appSlug, ...(resolvedTenantSlug && { tenantSlug: resolvedTenantSlug }) },
    );
    return this.buildLoginResponse(tokens, '[Admin] Login');
  }

  async refresh(refreshToken: string): Promise<AdminRefreshResponseDto> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');
    const tenantSlug = this.config.get<string>('bastionTenantSlug');

    const tokens = await this.callBastion<BastionTokenResponse>(
      'POST',
      `${bastionUrl}/auth/refresh`,
      { refreshToken, appSlug, ...(tenantSlug && { tenantSlug }) },
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
    return this.formatAdminUser(adminUser, admin.role, admin.username, adminUser.clientAccess.map((a) => a.clientId), admin.image);
  }

  async updateProfile(
    admin: AdminJwtPayload,
    data: { username?: string; image?: string },
  ): Promise<AdminUserResponseDto> {
    const updated = await this.prisma.adminUser.update({
      where: { bastionUserId: admin.sub },
      data: {
        ...(data.username !== undefined && { username: data.username }),
        ...(data.image !== undefined && { image: data.image }),
      },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`[Admin] Profile updated: bastionUserId=${admin.sub}`);
    return this.formatAdminUser(updated, admin.role, admin.username, updated.clientAccess.map((a) => a.clientId), admin.image);
  }

  // ─── Identity (proxied to Bastion) ──────────────────────────────────────────

  async updateGlobalProfile(
    accessToken: string,
    data: { username?: string; image?: string },
  ): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    await this.callBastion('PATCH', `${bastionUrl}/auth/me`, data, accessToken);
  }

  async requestEmailChange(accessToken: string, email: string, tenantSlug?: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const frontendUrl = this.config.get<string>('frontendUrl');
    const tenantPrefix = tenantSlug ? `/${encodeURIComponent(tenantSlug)}` : '';
    await this.callBastion(
      'PATCH',
      `${bastionUrl}/auth/me/email`,
      {
        email,
        confirmUrl: `${frontendUrl}${tenantPrefix}/admin/confirm-email`,
        revokeUrl: `${frontendUrl}${tenantPrefix}/admin/revoke-email-change`,
      },
      accessToken,
    );
  }

  async confirmEmailChange(token: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    await this.callBastion('POST', `${bastionUrl}/auth/me/confirm-email`, { token });
  }

  async revokeEmailChange(token: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    await this.callBastion('POST', `${bastionUrl}/auth/me/revoke-email-change`, { token });
  }

  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    await this.callBastion(
      'PATCH',
      `${bastionUrl}/auth/me/password`,
      { currentPassword, newPassword },
      accessToken,
    );
  }

  async forgotPassword(email: string, tenantSlug?: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    const frontendUrl = this.config.get<string>('frontendUrl');
    const appSlug = this.config.get<string>('bastionAppSlug');
    const resolvedTenantSlug = tenantSlug || this.config.get<string>('bastionTenantSlug');
    await this.callBastion('POST', `${bastionUrl}/auth/forgot-password`, {
      email,
      appSlug,
      resetUrl: `${frontendUrl}/admin/reset-password`,
      ...(resolvedTenantSlug && { tenantSlug: resolvedTenantSlug }),
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    await this.callBastion('POST', `${bastionUrl}/auth/reset-password`, { token, newPassword });
  }

  // ─── Admin User Management ──────────────────────────────────────────────────

  async createAdminUser(
    bastionUserId: string,
    email: string,
    username?: string,
    allClientsAccess = false,
    clientIds: string[] = [],
  ): Promise<AdminUserResponseDto> {
    const existing = await this.prisma.adminUser.findUnique({ where: { bastionUserId } });
    if (existing) throw new ConflictException('Admin user already exists for this Bastion user');

    const adminUser = await this.prisma.adminUser.create({
      data: {
        bastionUserId,
        email,
        username: username ?? null,
        allClientsAccess,
        clientAccess: clientIds.length
          ? { createMany: { data: clientIds.map((clientId) => ({ clientId })) } }
          : undefined,
      },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`[Admin] Created AdminUser: bastionUserId=${bastionUserId}`);
    return this.formatAdminUser(adminUser, 'VIEWER', username, adminUser.clientAccess.map((a) => a.clientId));
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

  private async buildLoginResponse(
    tokens: BastionTokenResponse,
    logLabel: string,
  ): Promise<AdminLoginResponseDto> {
    const decoded = this.jwtService.decode<BastionJwtPayload>(tokens.accessToken);
    if (!decoded?.sub) {
      throw new ServiceUnavailableException('Malformed token from auth service');
    }

    const adminUser = await this.prisma.adminUser.upsert({
      where: { bastionUserId: decoded.sub },
      create: {
        bastionUserId: decoded.sub,
        email: decoded.email,
        username: decoded.username ?? null,
        image: decoded.image ?? null,
        active: true,
        allClientsAccess: decoded.role === 'SUPER_ADMIN',
        lastLoginAt: new Date(),
      },
      update: {
        email: decoded.email,
        lastLoginAt: new Date(),
      },
      include: { clientAccess: { select: { clientId: true } } },
    });

    this.logger.log(`${logLabel}: bastionUserId=${decoded.sub}`);

    const expiresIn = decoded.exp - decoded.iat;
    const allowedClientIds = adminUser.clientAccess.map((a) => a.clientId);
    const user = this.formatAdminUser(adminUser, decoded.role, decoded.username, allowedClientIds, decoded.image);

    return plainToInstance(
      AdminLoginResponseDto,
      { ...tokens, expiresIn, user },
      { excludeExtraneousValues: true },
    );
  }

  private formatAdminUser(
    user: any,
    role: string,
    _jwtUsername: string | undefined,
    allowedClientIds: string[],
    _jwtImage?: string,
  ): AdminUserResponseDto {
    // Return raw DB values (null = no local override). Frontend merges with JWT claims.
    return plainToInstance(
      AdminUserResponseDto,
      { ...user, role, allowedClientIds },
      { excludeExtraneousValues: true },
    );
  }

  async getTenantInfo(slug: string): Promise<{ id: string; slug: string; name: string; active: boolean; createdAt: string }> {
    const bastionUrl = this.config.get<string>('bastionUrl');
    return this.getFromBastion(`${bastionUrl}/tenants/slug/${encodeURIComponent(slug)}`);
  }

  private async getFromBastion<T>(url: string): Promise<T> {
    try {
      const response = await firstValueFrom(this.httpService.get<T>(url));
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 404) throw new NotFoundException('Tenant not found');
      this.logger.error(`Bastion GET failed: ${url} → ${status ?? 'network error'} — ${JSON.stringify(error.response?.data ?? {})}`);
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
  }

  private async callBastion<T>(
    method: 'POST' | 'PATCH',
    url: string,
    body: object,
    bearerToken?: string,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.request<T>({
          method,
          url,
          data: body,
          ...(bearerToken && { headers: { Authorization: `Bearer ${bearerToken}` } }),
        }),
      );
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new UnauthorizedException(error.response?.data?.message ?? 'Invalid credentials');
      }
      this.logger.error(`Bastion call failed: ${method} ${url} → ${status ?? 'network error'} — ${JSON.stringify(error.response?.data ?? {})}`);
      throw new ServiceUnavailableException('Authentication service unavailable');
    }
  }
}
