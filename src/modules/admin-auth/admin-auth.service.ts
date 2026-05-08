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
import { plainToInstance } from 'class-transformer';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
} from './dto/admin-response.dto';
import { AdminJwtPayload } from './guards/admin-jwt.guard';
import { CryptoUtils } from './utils/crypto.utils';
import { parseExpiresInToSeconds, parseDays } from './utils/token.utils';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Auth ───────────────────────────────────────────────────────────────────

  /**
   * Generate a signed JWT access token for admin user
   * @param payload The JWT payload
   * @returns Object containing the token and expiration time in seconds
   */
  private signAccessToken(payload: Omit<AdminJwtPayload, never>): { token: string; expiresIn: number } {
    const expiresIn = this.config.get<string>('jwtAdminExpiresIn') || '15m';
    const token = this.jwtService.sign(payload, {
      secret: this.config.get<string>('jwtAdminSecret'),
      expiresIn: expiresIn as any,
    });
    const seconds = parseExpiresInToSeconds(expiresIn);
    return { token, expiresIn: seconds };
  }

  /**
   * Create and persist a refresh token
   * The raw token is returned to the client, while only its hash is stored in the database
   * @param adminUserId The admin user ID
   * @returns The raw (unhashed) refresh token to be sent to the client
   */
  private async createRefreshToken(adminUserId: string): Promise<string> {
    const rawToken = CryptoUtils.generateSecureToken();
    const tokenHash = CryptoUtils.hashToken(rawToken);

    const refreshExpiresIn = this.config.get<string | number>('jwtAdminRefreshExpiresInDays') || 7;
    const days = parseDays(refreshExpiresIn);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.adminRefreshToken.create({
      data: { adminUserId, tokenHash, expiresAt },
    });

    return rawToken;
  }


  /**
   * Authenticate an admin user and generate access/refresh tokens
   * @param email Admin user email
   * @param password Admin user password
   * @returns Login response with tokens and user info
   * @throws UnauthorizedException if credentials are invalid
   */
  async login(email: string, password: string): Promise<AdminLoginResponseDto> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { email },
      include: { clientAccess: { select: { clientId: true } } },
    });

    if (!adminUser || !adminUser.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await CryptoUtils.verifyPassword(password, adminUser.passwordHash);
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

    this.logger.log(`[Admin] User logged in: ${email}`);

    return plainToInstance(
      AdminLoginResponseDto,
      { accessToken, refreshToken, expiresIn, user: userDto },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Refresh access token using a valid refresh token
   * Implements token rotation: old refresh token is revoked and a new one is issued
   * @param rawRefreshToken The raw refresh token from the client
   * @returns New access and refresh tokens
   * @throws UnauthorizedException if refresh token is invalid or expired
   */
  async refresh(rawRefreshToken: string): Promise<AdminRefreshResponseDto> {
    const tokenHash = CryptoUtils.hashToken(rawRefreshToken);

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

  /**
   * Logout an admin user by revoking their refresh token
   * @param rawRefreshToken The raw refresh token to revoke
   * @returns Success message
   */
  async logout(rawRefreshToken: string): Promise<{ message: string }> {
    const tokenHash = CryptoUtils.hashToken(rawRefreshToken);

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

  /**
   * Get the current admin user's profile
   * @param admin The authenticated admin JWT payload
   * @returns Admin user profile
   * @throws NotFoundException if admin user not found
   */
  async getProfile(admin: AdminJwtPayload): Promise<AdminUserResponseDto> {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: admin.sub },
      include: { clientAccess: { select: { clientId: true } } },
    });
    if (!adminUser) throw new NotFoundException('Admin user not found');
    return this.formatAdminUser(adminUser, adminUser.clientAccess.map((a) => a.clientId));
  }

  /**
   * Update the current admin user's profile (name and/or email)
   * @param admin The authenticated admin JWT payload
   * @param data Profile update data
   * @returns Updated admin user profile
   * @throws ConflictException if email is already in use
   */
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

    this.logger.log(`[Admin] Profile updated for user: ${updated.email}`);

    return this.formatAdminUser(updated, updated.clientAccess.map((a) => a.clientId));
  }

  /**
   * Change the current admin user's password
   * @param admin The authenticated admin JWT payload
   * @param currentPassword The current password for verification
   * @param newPassword The new password to set
   * @returns Success message
   * @throws NotFoundException if admin user not found
   * @throws BadRequestException if current password is incorrect
   */
  async changePassword(
    admin: AdminJwtPayload,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const adminUser = await this.prisma.adminUser.findUnique({ where: { id: admin.sub } });
    if (!adminUser) throw new NotFoundException('Admin user not found');

    const isValid = await CryptoUtils.verifyPassword(currentPassword, adminUser.passwordHash);
    if (!isValid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await CryptoUtils.hashPassword(newPassword);
    await this.prisma.adminUser.update({ where: { id: admin.sub }, data: { passwordHash } });

    this.logger.log(`[Admin] Password changed for user: ${adminUser.email}`);

    return { message: 'Password changed successfully' };
  }

  // ─── Formatter ────────────────────────────────────────────────────────────

  /**
   * Format admin user for response
   * @param user The admin user from database
   * @param allowedClientIds List of allowed client IDs
   * @returns Formatted admin user response DTO
   */
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

