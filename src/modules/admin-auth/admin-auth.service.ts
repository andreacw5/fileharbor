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
} from './dto/admin-response.dto';
import { AdminJwtPayload } from './guards/admin-jwt.guard';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
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

