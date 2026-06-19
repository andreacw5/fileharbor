import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
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
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard, AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUser } from './decorators/admin-user.decorator';
import { AdminLoginDto, AdminExchangeDto } from './dto/admin-login.dto';
import {
  AdminUpdateProfileDto,
  UpdateEmailDto,
  ConfirmTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/admin-update-profile.dto';
import {
  AdminLoginResponseDto,
  AdminRefreshResponseDto,
  AdminUserResponseDto,
} from './dto/admin-response.dto';

const REFRESH_COOKIE = 'admin_rt';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (matches Bastion TTL)

@ApiTags('Admin - Authentication')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'strict', path: '/' });
  }

  // ─── Tenant info (public) ─────────────────────────────────────────────────

  @Get('tenant/:slug')
  @ApiOperation({ summary: 'Get tenant display info by slug — used to populate login page UI' })
  @ApiResponse({ status: 200, description: '{ id, slug, name, active, createdAt }' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  getTenantInfo(@Param('slug') slug: string) {
    return this.adminAuthService.getTenantInfo(slug);
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login via Bastion IdP' })
  @ApiResponse({ status: 200, type: AdminLoginResponseDto, description: 'Sets httpOnly refresh token cookie' })
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AdminLoginResponseDto, 'refreshToken'>> {
    const result = await this.adminAuthService.login(dto.email, dto.password, dto.tenantSlug);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Bastion OAuth code for session (social login landing)' })
  @ApiResponse({ status: 200, type: AdminLoginResponseDto, description: 'Sets httpOnly refresh token cookie' })
  async exchange(
    @Body() dto: AdminExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AdminLoginResponseDto, 'refreshToken'>> {
    const result = await this.adminAuthService.exchange(dto.code);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token via Bastion IdP' })
  @ApiResponse({ status: 200, type: AdminRefreshResponseDto, description: 'Issues new access token and rotates cookie' })
  @ApiResponse({ status: 401, description: 'Missing or invalid refresh token cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Omit<AdminRefreshResponseDto, 'refreshToken'>> {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const result = await this.adminAuthService.refresh(rawToken);
    this.setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...body } = result;
    return body;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke session via Bastion IdP and clear refresh cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
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
  @ApiOperation({ summary: 'Update current admin display name' })
  @ApiResponse({ status: 200, type: AdminUserResponseDto })
  updateProfile(
    @AdminUser() adminUser: AdminJwtPayload,
    @Body() dto: AdminUpdateProfileDto,
  ): Promise<AdminUserResponseDto> {
    return this.adminAuthService.updateProfile(adminUser, { username: dto.username, image: dto.image });
  }

  @Patch('me/global')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update global Bastion identity (username / image)' })
  @ApiResponse({ status: 200, description: 'Global profile updated — takes effect on next token refresh' })
  async updateGlobalProfile(
    @AdminUser() _adminUser: AdminJwtPayload,
    @Req() req: Request,
    @Body() dto: AdminUpdateProfileDto,
  ): Promise<{ message: string }> {
    const accessToken = req.headers['authorization']!.substring(7);
    await this.adminAuthService.updateGlobalProfile(accessToken, { username: dto.username, image: dto.image });
    return { message: 'Global profile updated. Changes reflect on next login or token refresh.' };
  }

  // ─── Identity (Bastion proxied) ───────────────────────────────────────────

  @Patch('me/email')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request email change — sends verification to new address via Bastion' })
  @ApiResponse({ status: 200, description: 'Verification emails sent' })
  async requestEmailChange(
    @AdminUser() adminUser: AdminJwtPayload,
    @Req() req: Request,
    @Body() dto: UpdateEmailDto,
  ): Promise<{ message: string }> {
    const accessToken = req.headers['authorization']!.substring(7);
    await this.adminAuthService.requestEmailChange(accessToken, dto.email, adminUser.tenantSlug);
    return { message: `Verification email sent to ${dto.email}` };
  }

  @Post('me/confirm-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm email change via token from email link' })
  @ApiResponse({ status: 200, description: 'Email updated — user must log in again' })
  async confirmEmailChange(@Body() dto: ConfirmTokenDto): Promise<{ message: string }> {
    await this.adminAuthService.confirmEmailChange(dto.token);
    return { message: 'Email updated. Please log in again.' };
  }

  @Post('me/revoke-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel pending email change via revoke token from email link' })
  @ApiResponse({ status: 200, description: 'Email change cancelled' })
  async revokeEmailChange(@Body() dto: ConfirmTokenDto): Promise<{ message: string }> {
    await this.adminAuthService.revokeEmailChange(dto.token);
    return { message: 'Email change cancelled.' };
  }

  @Patch('me/password')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password — proxied to Bastion, revokes all sessions' })
  @ApiResponse({ status: 200, description: 'Password updated — user must log in again' })
  @ApiResponse({ status: 401, description: 'Current password incorrect' })
  async changePassword(
    @AdminUser() _adminUser: AdminJwtPayload,
    @Req() req: Request,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const accessToken = req.headers['authorization']!.substring(7);
    await this.adminAuthService.changePassword(accessToken, dto.currentPassword, dto.newPassword);
    return { message: 'Password updated. Please log in again.' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset — sends link to email via Bastion' })
  @ApiResponse({ status: 200, description: 'Reset email sent if account exists' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.adminAuthService.forgotPassword(dto.email, dto.tenantSlug);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password via token from email link' })
  @ApiResponse({ status: 200, description: 'Password reset — user must log in again' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.adminAuthService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully. Please log in.' };
  }
}
