import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard, AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUser } from './decorators/admin-user.decorator';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminUpdateProfileDto, AdminChangePasswordDto } from './dto/admin-update-profile.dto';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
} from './dto/admin-response.dto';

@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminAuthController {
  private readonly REFRESH_COOKIE = 'admin_rt';

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  /** Scrive il refresh token come cookie httpOnly sul response */
  private setRefreshCookie(res: Response, token: string): void {
    const days = this.config.get<number>('jwtAdminRefreshExpiresInDays') || 7;
    res.cookie(this.REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('environment') !== 'development',
      sameSite: 'strict',
      maxAge: days * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  /** Cancella il refresh cookie */
  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.REFRESH_COOKIE, { httpOnly: true, sameSite: 'strict', path: '/' });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login as admin user' })
  @ApiResponse({ status: 200, type: AdminLoginResponseDto, description: 'Sets httpOnly refresh token cookie' })
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AdminLoginResponseDto, 'refreshToken'>> {
    const result = await this.adminAuthService.login(dto.email, dto.password);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using the httpOnly cookie' })
  @ApiResponse({ status: 200, type: AdminRefreshResponseDto, description: 'Issues new access token and rotates cookie' })
  @ApiResponse({ status: 401, description: 'Missing or invalid refresh token cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AdminRefreshResponseDto, 'refreshToken'>> {
    const rawToken = req.cookies?.[this.REFRESH_COOKIE];
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const result = await this.adminAuthService.refresh(rawToken);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke session and clear refresh token cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const rawToken = req.cookies?.[this.REFRESH_COOKIE];
    if (rawToken) await this.adminAuthService.logout(rawToken);
    this.clearRefreshCookie(res);
    return { message: 'Logged out successfully' };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin profile' })
  @ApiResponse({ status: 200, type: AdminUserResponseDto })
  getProfile(@AdminUser() adminUser: AdminJwtPayload): Promise<AdminUserResponseDto> {
    return this.adminAuthService.getProfile(adminUser);
  }

  @Patch('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current admin profile (name, email)' })
  @ApiResponse({ status: 200, type: AdminUserResponseDto })
  updateProfile(
    @AdminUser() adminUser: AdminJwtPayload,
    @Body() dto: AdminUpdateProfileDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminAuthService.updateProfile(adminUser, dto);
  }

  @Post('me/change-password')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current admin password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect or passwords do not match' })
  changePassword(
    @AdminUser() adminUser: AdminJwtPayload,
    @Body() dto: AdminChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.adminAuthService.changePassword(adminUser, dto.currentPassword, dto.newPassword);
  }
}

