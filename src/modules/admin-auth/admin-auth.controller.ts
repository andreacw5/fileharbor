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
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard, AdminJwtPayload } from './guards/admin-jwt.guard';
import { AdminUser } from './decorators/admin-user.decorator';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminUpdateProfileDto } from './dto/admin-update-profile.dto';
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

  // ─── Auth ──────────────────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login via Bastion IdP' })
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
    return this.adminAuthService.updateProfile(adminUser, dto);
  }
}
