# Bastion Integration Guide

> Give this file to Claude when integrating Bastion into a new NestJS app.
> Goal: a single `BastionModule` that owns all HTTP calls to Bastion. Every other module injects `BastionService` — nothing calls Bastion directly.

---

## Architecture

```
Browser
  └─► POST /api/auth/login          (your app's AuthController)
        └─► BastionService.login()  (HTTP → Bastion :3001)
              └─► returns { accessToken, refreshToken }
App backend sets httpOnly cookie for refreshToken, returns accessToken in body.

Subsequent requests: browser sends Bearer accessToken.
App validates JWT locally via JWKS (no Bastion call per request).
```

**Never expose Bastion's port to the browser.** All Bastion traffic goes app-backend → Bastion.

---

## Environment variables required

```env
BASTION_URL=http://localhost:3001          # internal URL
BASTION_APP_SLUG=your-app-slug            # slug registered in Bastion
BASTION_TENANT_SLUG=your-tenant-slug      # omit only if app belongs to 1 tenant
BASTION_JWKS_TTL_MS=3600000              # JWKS cache TTL (default 1h)
```

---

## BastionModule — implement this

### File structure

```
src/
  modules/
    bastion/
      bastion.module.ts
      bastion.service.ts
      bastion-jwks.service.ts     ← JWKS fetch + cache + RS256 verify
      bastion-audit.service.ts    ← service-client JWT + centralized audit writes
      bastion.types.ts            ← shared DTOs/interfaces
      guards/
        bastion-jwt.guard.ts      ← replaces NestJS JwtAuthGuard
      decorators/
        current-user.decorator.ts
        public.decorator.ts
```

### `bastion.types.ts`

```typescript
export interface JwtPayload {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  username: string;
  image: string | null;
  preferredLocale: string;
  appSlug: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TwoFactorPendingResponse {
  twoFactorPending: true;
  twoFactorToken: string;
}

export type LoginResponse = TokenResponse | TwoFactorPendingResponse;
```

### `bastion-jwks.service.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jose from 'jose'; // pnpm add jose

@Injectable()
export class BastionJwksService {
  private cached: jose.KeyLike[] = [];
  private cachedAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get ttl() {
    return this.config.get<number>('BASTION_JWKS_TTL_MS') ?? 3_600_000;
  }

  private async fetchKeys(): Promise<jose.KeyLike[]> {
    const url = `${this.config.get<string>('BASTION_URL')}/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const { keys } = await res.json() as { keys: jose.JWK[] };
    return Promise.all(keys.map(k => jose.importJWK(k, 'RS256') as Promise<jose.KeyLike>));
  }

  private async getKeys(): Promise<jose.KeyLike[]> {
    if (Date.now() - this.cachedAt < this.ttl && this.cached.length) return this.cached;
    this.cached = await this.fetchKeys();
    this.cachedAt = Date.now();
    return this.cached;
  }

  async verify(token: string): Promise<JwtPayload> {
    const keys = await this.getKeys();
    for (const key of keys) {
      try {
        const { payload } = await jose.jwtVerify(token, key, { algorithms: ['RS256'] });
        return payload as unknown as JwtPayload;
      } catch { /* try next key */ }
    }
    throw new UnauthorizedException('Invalid token');
  }
}
```

### `bastion.service.ts`

This is the only file that makes HTTP calls to Bastion. All methods accept `appSlug` and `tenantSlug` from config — callers don't pass them.

```typescript
import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginResponse, TokenResponse } from './bastion.types';

@Injectable()
export class BastionService {
  private readonly logger = new Logger(BastionService.name);

  constructor(private readonly config: ConfigService) {}

  private get base() { return this.config.get<string>('BASTION_URL'); }
  private get appSlug() { return this.config.get<string>('BASTION_APP_SLUG'); }
  private get tenantSlug() { return this.config.get<string>('BASTION_TENANT_SLUG'); }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new HttpException((err as any).message ?? 'Bastion error', res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  login(email: string, password: string): Promise<LoginResponse> {
    return this.call('POST', '/auth/login', {
      email, password,
      appSlug: this.appSlug,
      tenantSlug: this.tenantSlug,
    });
  }

  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.call('POST', '/auth/refresh', {
      refreshToken,
      appSlug: this.appSlug,
      tenantSlug: this.tenantSlug,
    });
  }

  logout(refreshToken: string): Promise<void> {
    return this.call('POST', '/auth/logout', { refreshToken });
  }

  me(accessToken: string) {
    return this.call('GET', '/auth/me', undefined, accessToken);
  }

  meEvents(accessToken: string, params: {
    appSlug?: string; event?: string; from?: string;
    to?: string; page?: number; limit?: number;
  } = {}) {
    const qs = new URLSearchParams(Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, String(v)])).toString();
    return this.call('GET', `/auth/me/events${qs ? `?${qs}` : ''}`, undefined, accessToken);
  }

  // ─── Account (requires valid accessToken) ────────────────────────────────

  updateProfile(accessToken: string, data: { username?: string; image?: string; preferredLocale?: string }) {
    return this.call('PATCH', '/auth/me', data, accessToken);
  }

  changePassword(accessToken: string, data: { currentPassword: string; newPassword: string }) {
    return this.call('PATCH', '/auth/me/password', data, accessToken);
  }

  requestEmailChange(accessToken: string, data: { email: string }) {
    return this.call('PATCH', '/auth/me/email', data, accessToken);
  }

  confirmEmailChange(token: string) {
    return this.call('POST', '/auth/me/confirm-email', { token });
  }

  revokeEmailChange(token: string) {
    return this.call('POST', '/auth/me/revoke-email-change', { token });
  }

  /**
   * GDPR Art. 17 — right to erasure.
   * Permanently deletes the user account in the tenant. Irreversible.
   * Bastion dispatches a `user.deleted` webhook after deletion.
   */
  deleteSelf(accessToken: string): Promise<void> {
    return this.call('DELETE', '/auth/me', undefined, accessToken);
  }

  /**
   * GDPR Art. 20 — data portability.
   * Returns profile, app roles and linked social accounts for the tenant.
   * Does not include audit logs, tokens, or password hashes.
   */
  exportData(accessToken: string) {
    return this.call('GET', '/auth/me/export', undefined, accessToken);
  }

  verifyEmail(token: string) {
    return this.call('GET', `/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  resendVerification(data: { email: string; appSlug?: string; tenantSlug?: string }) {
    return this.call('POST', '/auth/resend-verification', {
      ...data,
      appSlug: data.appSlug ?? this.appSlug,
      tenantSlug: data.tenantSlug ?? this.tenantSlug,
    });
  }

  forgotPassword(email: string) {
    return this.call('POST', '/auth/forgot-password', {
      email,
      appSlug: this.appSlug,
      tenantSlug: this.tenantSlug,
    });
  }

  resetPassword(data: { token: string; password: string }) {
    return this.call('POST', '/auth/reset-password', data);
  }

  // ─── 2FA ─────────────────────────────────────────────────────────────────

  twoFactorStatus(accessToken: string) {
    return this.call('GET', '/2fa/status', undefined, accessToken);
  }

  twoFactorSetup(accessToken: string) {
    return this.call('POST', '/2fa/setup', undefined, accessToken);
  }

  twoFactorConfirm(accessToken: string, code: string) {
    return this.call('POST', '/2fa/confirm', { code }, accessToken);
  }

  twoFactorDisable(accessToken: string, code: string) {
    return this.call('POST', '/2fa/disable', { code }, accessToken);
  }

  twoFactorAuthenticate(data: { twoFactorToken: string; code: string; }, ip?: string, userAgent?: string) {
    return this.call('POST', '/2fa/authenticate', data);
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────

  /**
   * Returns the redirect URL the browser should be sent to.
   * Format: `${BASTION_URL}/auth/oauth/${provider}?appSlug=...&tenantSlug=...&redirectUrl=...`
   */
  oauthInitiateUrl(provider: 'discord' | 'google', redirectUrl: string): string {
    const params = new URLSearchParams({
      appSlug: this.appSlug!,
      ...(this.tenantSlug && { tenantSlug: this.tenantSlug }),
      redirectUrl,
    });
    return `${this.base}/auth/oauth/${provider}?${params}`;
  }

  exchangeOAuthCode(code: string): Promise<TokenResponse> {
    return this.call('POST', '/auth/exchange', { code });
  }

  socialAccounts(accessToken: string) {
    return this.call('GET', '/auth/me/social-accounts', undefined, accessToken);
  }

  unlinkSocialAccount(accessToken: string, provider: 'discord' | 'google') {
    return this.call('DELETE', `/auth/me/social-accounts/${provider}`, undefined, accessToken);
  }

  syncSocialAvatar(accessToken: string, provider: 'discord' | 'google') {
    return this.call('PATCH', `/auth/me/social-accounts/${provider}`, undefined, accessToken);
  }

  // ─── Admin — Users (requires ADMIN role in bastion app) ──────────────────

  adminListUsers(accessToken: string, params: { search?: string; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams(Object.entries(params)
      .filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    return this.call('GET', `/users${qs ? `?${qs}` : ''}`, undefined, accessToken);
  }

  adminCreateUser(accessToken: string, data: { email: string; username: string; password?: string; tenantId: string }) {
    return this.call('POST', '/users', data, accessToken);
  }

  adminGetUser(accessToken: string, userId: string) {
    return this.call('GET', `/users/${userId}`, undefined, accessToken);
  }

  adminUpdateUser(accessToken: string, userId: string, data: { username?: string; active?: boolean }) {
    return this.call('PATCH', `/users/${userId}`, data, accessToken);
  }

  adminDeleteUser(accessToken: string, userId: string) {
    return this.call('DELETE', `/users/${userId}`, undefined, accessToken);
  }

  adminGetUserRoles(accessToken: string, userId: string) {
    return this.call('GET', `/users/${userId}/roles`, undefined, accessToken);
  }

  adminUpsertUserRole(accessToken: string, userId: string, appSlug: string, data: { roleId: string; tenantId: string }) {
    return this.call('PUT', `/users/${userId}/roles/${appSlug}`, data, accessToken);
  }

  adminDeleteUserRole(accessToken: string, userId: string, appSlug: string) {
    return this.call('DELETE', `/users/${userId}/roles/${appSlug}`, undefined, accessToken);
  }

  adminGetUserSessions(accessToken: string, userId: string) {
    return this.call('GET', `/users/${userId}/sessions`, undefined, accessToken);
  }

  // ─── Admin — Apps ─────────────────────────────────────────────────────────

  adminListApps(accessToken: string) {
    return this.call('GET', '/apps', undefined, accessToken);
  }

  adminCreateApp(accessToken: string, data: { slug: string; name: string }) {
    return this.call('POST', '/apps', data, accessToken);
  }

  adminUpdateApp(accessToken: string, slug: string, data: { name?: string; active?: boolean }) {
    return this.call('PATCH', `/apps/${slug}`, data, accessToken);
  }

  adminGetApp(accessToken: string, slug: string) {
    return this.call('GET', `/apps/${slug}`, undefined, accessToken);
  }

  adminGetAppRoles(accessToken: string, slug: string) {
    return this.call('GET', `/apps/${slug}/roles`, undefined, accessToken);
  }

  adminCreateRole(accessToken: string, slug: string, data: { name: string }) {
    return this.call('POST', `/apps/${slug}/roles`, data, accessToken);
  }

  adminUpdateRole(accessToken: string, slug: string, roleId: string, data: { name?: string }) {
    return this.call('PATCH', `/apps/${slug}/roles/${roleId}`, data, accessToken);
  }

  adminDeleteRole(accessToken: string, slug: string, roleId: string) {
    return this.call('DELETE', `/apps/${slug}/roles/${roleId}`, undefined, accessToken);
  }

  adminGetRolePermissions(accessToken: string, slug: string, roleId: string) {
    return this.call('GET', `/apps/${slug}/roles/${roleId}/permissions`, undefined, accessToken);
  }

  adminSetRolePermissions(accessToken: string, slug: string, roleId: string, permissions: string[]) {
    return this.call('PUT', `/apps/${slug}/roles/${roleId}/permissions`, { permissions }, accessToken);
  }

  // ─── Admin — Tenants ──────────────────────────────────────────────────────

  getTenantBySlug(slug: string) {
    return this.call('GET', `/tenants/slug/${slug}`); // public endpoint
  }

  adminListTenants(accessToken: string) {
    return this.call('GET', '/tenants', undefined, accessToken);
  }

  adminCreateTenant(accessToken: string, data: { slug: string; name: string }) {
    return this.call('POST', '/tenants', data, accessToken);
  }

  adminUpdateTenant(accessToken: string, tenantId: string, data: { name?: string; active?: boolean }) {
    return this.call('PATCH', `/tenants/${tenantId}`, data, accessToken);
  }

  adminGetTenantApps(accessToken: string, tenantId: string) {
    return this.call('GET', `/tenants/${tenantId}/apps`, undefined, accessToken);
  }

  adminAddTenantApp(accessToken: string, tenantId: string, data: { appId: string }) {
    return this.call('POST', `/tenants/${tenantId}/apps`, data, accessToken);
  }

  adminRemoveTenantApp(accessToken: string, tenantId: string, appId: string) {
    return this.call('DELETE', `/tenants/${tenantId}/apps/${appId}`, undefined, accessToken);
  }
}
```

### `guards/bastion-jwt.guard.ts`

Validates the Bearer token locally (no Bastion call). Replace NestJS's `JwtAuthGuard` with this globally.

```typescript
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BastionJwksService } from '../bastion-jwks.service';

export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class BastionJwtGuard implements CanActivate {
  constructor(
    private readonly jwks: BastionJwksService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = auth.slice(7);
    req.user = await this.jwks.verify(token);
    return true;
  }
}
```

Register globally in `AppModule`:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { BastionJwtGuard } from './modules/bastion/guards/bastion-jwt.guard';

// in providers:
{ provide: APP_GUARD, useClass: BastionJwtGuard },
```

### `decorators/current-user.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../bastion.types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
```

### `decorators/public.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata('isPublic', true);
```

---

## How to use BastionService from other modules

### Import once at feature module level

```typescript
import { BastionModule } from '../modules/bastion/bastion.module';

@Module({
  imports: [BastionModule],
  controllers: [YourController],
  providers: [YourService],
})
export class YourModule {}
```

### Example: AuthController (thin proxy)

```typescript
@Controller('auth')
export class AuthController {
  constructor(private readonly bastion: BastionService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: { email: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.bastion.login(dto.email, dto.password);
    if ('twoFactorPending' in result) return result; // return twoFactorToken to browser
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/',
    });
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies['refreshToken'];
    if (!refreshToken) throw new UnauthorizedException();
    const result = await this.bastion.refresh(refreshToken);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/',
    });
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies['refreshToken'];
    if (refreshToken) await this.bastion.logout(refreshToken);
    res.clearCookie('refreshToken', { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user; // already validated by guard — no Bastion call
  }
}
```

### Example: OAuth flow

```typescript
@Public()
@Get('oauth/:provider')
oauthStart(@Param('provider') provider: 'discord' | 'google', @Res() res: Response) {
  // YOUR app's callback URL, NOT Bastion's
  const redirectUrl = `https://yourapp.com/api/auth/oauth/${provider}/callback`;
  return res.redirect(this.bastion.oauthInitiateUrl(provider, redirectUrl));
}

// Bastion calls this after OAuth completes — receives one-time code
@Public()
@Get('oauth/:provider/callback')
async oauthCallback(@Query('code') code: string, @Res() res: Response) {
  const tokens = await this.bastion.exchangeOAuthCode(code);
  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/',
  });
  // redirect browser to your frontend
  return res.redirect('/dashboard');
}
```

### Example: 2FA flow

Login returns `{ twoFactorPending: true, twoFactorToken: "..." }`.
Browser stores `twoFactorToken` temporarily, shows TOTP input, then:

```typescript
@Public()
@Post('2fa/authenticate')
@HttpCode(200)
async twoFactor(
  @Body() dto: { twoFactorToken: string; code: string },
  @Res({ passthrough: true }) res: Response,
  @Req() req: Request,
) {
  const result = await this.bastion.twoFactorAuthenticate(dto);
  res.cookie('refreshToken', (result as TokenResponse).refreshToken, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/',
  });
  return { accessToken: (result as TokenResponse).accessToken };
}
```

### Example: Account management

```typescript
@Patch('account/password')
changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto, @Headers('authorization') auth: string) {
  return this.bastion.changePassword(auth.slice(7), dto);
}

@Public()
@Post('account/forgot-password')
forgotPassword(@Body('email') email: string) {
  return this.bastion.forgotPassword(email);
}

// GDPR Art. 17 — right to erasure
@Delete('account/me')
@HttpCode(204)
async deleteSelf(@Headers('authorization') auth: string, @Res({ passthrough: true }) res: Response) {
  await this.bastion.deleteSelf(auth.slice(7));
  res.clearCookie('refreshToken', { path: '/' });
}

// GDPR Art. 20 — data portability
@Get('account/me/export')
exportData(@Headers('authorization') auth: string) {
  return this.bastion.exportData(auth.slice(7));
}
```

---

## JWT payload fields available after guard

```typescript
// req.user / @CurrentUser()
{
  sub: string;           // user UUID
  tenantId: string;
  tenantSlug: string;    // use this to scope your DB queries
  email: string;
  username: string;
  image: string | null;
  preferredLocale: string;
  appSlug: string;       // validate this matches your app
  role: string;          // e.g. "ADMIN", "MEMBER"
  permissions: string[]; // e.g. ["build.approve"]
}
```

Always scope DB queries by `tenantSlug` or `tenantId` from the JWT — never trust user-supplied tenant values.

---

## Required packages

```bash
pnpm add jose                    # JWKS + JWT verification
pnpm add cookie-parser           # parse httpOnly cookies
pnpm add @types/cookie-parser -D
```

In `main.ts`:
```typescript
import cookieParser from 'cookie-parser';
app.use(cookieParser());
```

---

## Centralized Audit Log

Bastion provides a single audit log store for the entire tenant. Your app writes events to Bastion via `POST /events` using a **service-client JWT** — not a user JWT. Auth events (`auth.*`) are written by Bastion itself; your app writes app-domain events (`build.approved`, `file.deleted`, etc.).

### Flow

```
[One-time setup — admin]
POST /clients  { name, serviceSlug, scopes }
→ { apiKey: "sc_xxxx..." }   ← stored as env var, shown once only

[On app startup / token expiry]
POST /auth/client  { apiKey, serviceSlug, tenantSlug? }
→ { accessToken }             ← RS256 JWT, TTL 1h, type: "service_client"

[Per audit event]
POST /events  Bearer <accessToken>
  { event: "build.approved", userId?, metadata? }
→ { id, createdAt }
```

### One-time setup: register the ServiceClient

Requires an ADMIN JWT for your tenant in the `bastion` app.

```bash
curl -X POST https://bastion:3001/clients \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "MyApp Prod", "serviceSlug": "my-app" }'
# → { "id": "...", "apiKey": "sc_abc123...", ... }
# Store apiKey as BASTION_CLIENT_API_KEY — never retrievable again.
```

### Add methods to `BastionService`

```typescript
// ─── Service Client Auth ──────────────────────────────────────────────────

clientAuth(): Promise<{ accessToken: string }> {
  return this.call('POST', '/auth/client', {
    apiKey: this.config.getOrThrow('BASTION_CLIENT_API_KEY'),
    serviceSlug: this.appSlug,
    tenantSlug: this.tenantSlug,
  });
}

// ─── Centralized Audit Events ─────────────────────────────────────────────

writeAuditEvent(
  accessToken: string,
  data: { event: string; userId?: string; metadata?: Record<string, unknown> },
): Promise<{ id: string; createdAt: Date }> {
  return this.call('POST', '/events', data, accessToken);
}

adminListAuditEvents(accessToken: string, params: {
  tenantId?: string; userId?: string; appSlug?: string;
  event?: string; from?: string; to?: string;
  page?: number; limit?: number;
} = {}) {
  const qs = new URLSearchParams(Object.entries(params)
    .filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  return this.call('GET', `/events${qs ? `?${qs}` : ''}`, undefined, accessToken);
}

adminGetAuditEvent(accessToken: string, eventId: string) {
  return this.call('GET', `/events/${eventId}`, undefined, accessToken);
}

// ─── Service Client Management (ADMIN) ───────────────────────────────────

adminCreateClient(accessToken: string, data: { name: string; serviceSlug: string; scopes?: string[] }) {
  return this.call('POST', '/clients', data, accessToken);
}

adminListClients(accessToken: string, serviceSlug?: string) {
  const qs = serviceSlug ? `?serviceSlug=${serviceSlug}` : '';
  return this.call('GET', `/clients${qs}`, undefined, accessToken);
}

adminUpdateClient(accessToken: string, clientId: string, data: { name?: string; scopes?: string[]; isActive?: boolean }) {
  return this.call('PATCH', `/clients/${clientId}`, data, accessToken);
}

adminRotateClientKey(accessToken: string, clientId: string): Promise<{ apiKey: string }> {
  return this.call('POST', `/clients/${clientId}/rotate-key`, undefined, accessToken);
}

adminDeactivateClient(accessToken: string, clientId: string): Promise<void> {
  return this.call('DELETE', `/clients/${clientId}`, undefined, accessToken);
}
```

### `BastionAuditService` — token-rotating wrapper

The service-client JWT has TTL 1h and must be refreshed. Encapsulate this in a dedicated service so callers never handle the token directly.

**`src/modules/bastion/bastion-audit.service.ts`**

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BastionService } from './bastion.service';

@Injectable()
export class BastionAuditService implements OnModuleInit {
  private readonly logger = new Logger(BastionAuditService.name);
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly bastion: BastionService) {}

  async onModuleInit() {
    await this.ensureToken();
  }

  private async ensureToken(): Promise<string> {
    // Refresh 5 min before expiry (token TTL is 1h)
    if (this.token && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return this.token;
    }
    const { accessToken } = await this.bastion.clientAuth();
    this.token = accessToken;
    this.expiresAt = Date.now() + 60 * 60 * 1000;
    this.logger.log('service client token refreshed');
    return this.token;
  }

  async write(
    event: string,
    opts: { userId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    const token = await this.ensureToken();
    await this.bastion.writeAuditEvent(token, { event, ...opts })
      .catch((err) => this.logger.error(`audit write failed event=${event}`, err?.message));
  }
}
```

Register in `BastionModule`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BastionService } from './bastion.service';
import { BastionJwksService } from './bastion-jwks.service';
import { BastionAuditService } from './bastion-audit.service';

@Module({
  imports: [ConfigModule],
  providers: [BastionService, BastionJwksService, BastionAuditService],
  exports: [BastionService, BastionJwksService, BastionAuditService],
})
export class BastionModule {}
```

### Usage in feature services

```typescript
import { BastionAuditService } from '../modules/bastion/bastion-audit.service';

@Injectable()
export class BuildsService {
  constructor(private readonly audit: BastionAuditService) {}

  async approveBuild(buildId: string, user: JwtPayload) {
    // ... business logic ...

    // fire-and-forget — never await audit writes on the hot path
    this.audit.write('build.approved', {
      userId: user.sub,
      metadata: { buildId },
    });
  }
}
```

### Event name rules

- Format: `resource.action` — lowercase, alphanumeric + underscores, dot separator
- Examples: `build.approved`, `file.deleted`, `invite.sent`
- `auth.*` prefix is **reserved** — Bastion rejects these with 400
- Max 128 chars, min 3 chars

### Metadata constraints

- Max 50 keys, max 3 levels deep, string values ≤ 1000 chars
- No PII, no tokens, no passwords, no internal IDs that expose schema

### Read audit events (admin)

```typescript
// in an AdminController, with BastionAuditService token or a user admin JWT:
@Get('admin/events')
@RequireRole('ADMIN')
async listEvents(@CurrentUser() user: JwtPayload, @Headers('authorization') auth: string, @Query() q: any) {
  return this.bastion.adminListAuditEvents(auth.slice(7), {
    tenantId: user.tenantId,
    appSlug: q.appSlug,
    event: q.event,
    from: q.from,
    to: q.to,
    page: q.page,
    limit: q.limit,
  });
}
```

### Environment variables (add to existing)

```env
BASTION_CLIENT_API_KEY=sc_xxxx...   # from POST /clients, store securely
```

---

## Webhooks

Bastion dispatches signed HTTP POST requests to your app when identity events occur. Zero polling required.

### Setup

Set a webhook URL on your app via admin. Bastion auto-generates a secret and returns it **once** — store it immediately.

```bash
curl -X PATCH https://bastion:3001/apps/your-app-slug \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{ "webhookUrl": "https://yourapp.com/api/webhooks/bastion" }'
# → { ..., "webhookUrl": "https://...", "webhookSecret": "whsec_abc123..." }
# webhookSecret shown ONCE — store as BASTION_WEBHOOK_SECRET
```

To rotate the secret, set `webhookUrl` again (same or new URL).

To disable webhooks, set `webhookUrl: null`.

### Incoming request format

```
POST /api/webhooks/bastion
Content-Type: application/json
X-Bastion-Event: user.deleted
X-Bastion-Signature: sha256=<hmac-hex>

{ "event": "user.deleted", "tenantSlug": "dbd", "userId": "uuid", "timestamp": "ISO8601" }
```

### Signature verification

Always verify before processing. Bastion signs the raw JSON body with HMAC-SHA256.

```typescript
import { createHmac } from 'crypto';

function verifyBastionSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}
```

In NestJS — use `RawBodyRequest` and register `bodyParser` with `rawBody: true` in `main.ts`:

```typescript
// main.ts
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));

// webhook.controller.ts
@Public()
@Post('webhooks/bastion')
@HttpCode(204)
async handleBastionWebhook(@Req() req: RawBodyRequest<Request>) {
  const sig = req.headers['x-bastion-signature'] as string;
  const valid = verifyBastionSignature(req.rawBody!, sig, process.env.BASTION_WEBHOOK_SECRET!);
  if (!valid) throw new UnauthorizedException('Invalid webhook signature');

  const payload = req.body as BastionWebhookPayload;
  // handle payload.event
}
```

**Always return 2xx quickly** — Bastion marks delivery SUCCESS on any 2xx. Process async (queue it) if handling is slow.

### Events reference

All payloads share the base fields: `event`, `tenantSlug`, `userId`, `timestamp` (ISO 8601).

| Event | Trigger | Extra fields |
|---|---|---|
| `user.deleted` | User deleted self (`DELETE /auth/me`) | — |
| `user.deactivated` | Admin soft-deleted user (`DELETE /users/:id`) | — |
| `user.role_changed` | Admin changed user role in an app | `appSlug`, `oldRole`, `newRole` |
| `auth.email_changed` | User confirmed email change | `newEmail` |
| `auth.oauth_linked` | User linked OAuth account | `provider`, `avatarUrl` |
| `auth.oauth_unlinked` | User unlinked OAuth account | `provider` |
| `auth.2fa_enabled` | User enabled TOTP 2FA | — |
| `auth.2fa_disabled` | User disabled TOTP 2FA | — |

Example payload for `user.role_changed`:

```json
{
  "event": "user.role_changed",
  "tenantSlug": "dbd",
  "userId": "uuid",
  "appSlug": "dbd-builds",
  "oldRole": "MEMBER",
  "newRole": "ADMIN",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

> **Note:** `user.role_changed` is delivered only to the app whose slug matches `appSlug`. All other events are delivered to every app in the tenant that has a `webhookUrl` set.

### Delivery lifecycle

```
PENDING → deliver → SUCCESS
                  → FAILED   (retried with exponential backoff, up to 10 attempts)
                  → ABANDONED (max attempts reached — manual retry available)
```

Backoff schedule (seconds after failure): `0, 30, 120, 480, 1800, 7200, 28800, 86400, 172800, 259200`

Timeout per attempt: 10 seconds. Redirects are not followed.

### Monitor deliveries (admin)

```bash
# List deliveries for an app
GET /apps/:slug/webhook-deliveries?status=FAILED&event=user.deleted&page=1&limit=20
Authorization: Bearer <admin-token>

# Get delivery detail (includes full payload)
GET /apps/:slug/webhook-deliveries/:id

# Manually retry a FAILED or ABANDONED delivery
POST /apps/:slug/webhook-deliveries/:id/retry
```

### Add methods to `BastionService`

```typescript
// ─── Webhook management (ADMIN) ──────────────────────────────────────────────

adminListWebhookDeliveries(
  accessToken: string,
  appSlug: string,
  params: { status?: string; event?: string; page?: number; limit?: number } = {},
) {
  const qs = new URLSearchParams(Object.entries(params)
    .filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  return this.call('GET', `/apps/${appSlug}/webhook-deliveries${qs ? `?${qs}` : ''}`, undefined, accessToken);
}

adminGetWebhookDelivery(accessToken: string, appSlug: string, deliveryId: string) {
  return this.call('GET', `/apps/${appSlug}/webhook-deliveries/${deliveryId}`, undefined, accessToken);
}

adminRetryWebhookDelivery(accessToken: string, appSlug: string, deliveryId: string): Promise<{ message: string }> {
  return this.call('POST', `/apps/${appSlug}/webhook-deliveries/${deliveryId}/retry`, undefined, accessToken);
}
```

### Environment variables (add to existing)

```env
BASTION_WEBHOOK_SECRET=whsec_...   # from PATCH /apps/:slug response, store securely
```

---

## Security rules

- **Never log** `refreshToken`, `accessToken`, `code` (OAuth), or `twoFactorToken` values.
- **Never forward** `Authorization` header from browser directly to Bastion — extract the bearer, call `BastionJwksService.verify()` instead.
- The `refreshToken` cookie must be `httpOnly: true, secure: true, sameSite: 'strict'`.
- Validate `appSlug` in JWT matches your app: add a check in `BastionJwtGuard` if needed.
- Endpoints marked `@Public()` skip the guard — use sparingly.

---

## Complete endpoint reference

| Your route | Method | Bastion call | Auth |
|---|---|---|---|
| `/auth/login` | POST | `login()` | public |
| `/auth/refresh` | POST | `refresh()` | cookie |
| `/auth/logout` | POST | `logout()` | cookie |
| `/auth/me` | GET | local JWT | Bearer |
| `/auth/me/events` | GET | `meEvents()` | Bearer |
| `/auth/oauth/:provider` | GET | redirect to `oauthInitiateUrl()` | public |
| `/auth/oauth/:provider/callback` | GET | `exchangeOAuthCode()` | public |
| `/auth/2fa/authenticate` | POST | `twoFactorAuthenticate()` | public |
| `/auth/2fa/status` | GET | `twoFactorStatus()` | Bearer |
| `/auth/2fa/setup` | POST | `twoFactorSetup()` | Bearer |
| `/auth/2fa/confirm` | POST | `twoFactorConfirm()` | Bearer |
| `/auth/2fa/disable` | POST | `twoFactorDisable()` | Bearer |
| `/account/me` | DELETE | `deleteSelf()` | Bearer |
| `/account/me/export` | GET | `exportData()` | Bearer |
| `/account/me` | PATCH | `updateProfile()` | Bearer |
| `/account/password` | PATCH | `changePassword()` | Bearer |
| `/account/email` | PATCH | `requestEmailChange()` | Bearer |
| `/account/confirm-email` | POST | `confirmEmailChange()` | public (token in body) |
| `/account/revoke-email-change` | POST | `revokeEmailChange()` | public (token in body) |
| `/account/verify-email` | GET | `verifyEmail()` | public (token in query) |
| `/account/resend-verification` | POST | `resendVerification()` | public |
| `/account/forgot-password` | POST | `forgotPassword()` | public |
| `/account/reset-password` | POST | `resetPassword()` | public |
| `/account/social-accounts` | GET | `socialAccounts()` | Bearer |
| `/account/social-accounts/:p` | DELETE | `unlinkSocialAccount()` | Bearer |
| `/account/social-accounts/:p` | PATCH | `syncSocialAvatar()` | Bearer |
| `/admin/users` | GET/POST | `adminListUsers/CreateUser()` | Bearer + ADMIN |
| `/admin/users/:id` | GET/PATCH/DELETE | `adminGetUser/UpdateUser/DeleteUser()` | Bearer + ADMIN |
| `/admin/users/:id/roles` | GET | `adminGetUserRoles()` | Bearer + ADMIN |
| `/admin/users/:id/roles/:app` | PUT/DELETE | `adminUpsertUserRole/DeleteUserRole()` | Bearer + ADMIN |
| `/admin/users/:id/sessions` | GET | `adminGetUserSessions()` | Bearer + ADMIN |
| `/admin/apps` | GET/POST | `adminListApps/CreateApp()` | Bearer + ADMIN |
| `/admin/apps/:slug` | GET/PATCH | `adminGetApp/UpdateApp()` (set `webhookUrl` here) | Bearer + ADMIN |
| `/admin/apps/:slug/roles` | GET/POST | `adminGetAppRoles/CreateRole()` | Bearer + ADMIN |
| `/admin/apps/:slug/roles/:id` | PATCH/DELETE | `adminUpdateRole/DeleteRole()` | Bearer + ADMIN |
| `/admin/apps/:slug/roles/:id/permissions` | GET/PUT | `adminGetRolePermissions/SetRolePermissions()` | Bearer + ADMIN |
| `/admin/tenants` | GET/POST | `adminListTenants/CreateTenant()` | Bearer + ADMIN |
| `/admin/tenants/:id` | PATCH | `adminUpdateTenant()` | Bearer + ADMIN |
| `/admin/tenants/:id/apps` | GET/POST | `adminGetTenantApps/AddTenantApp()` | Bearer + ADMIN |
| `/admin/tenants/:id/apps/:appId` | DELETE | `adminRemoveTenantApp()` | Bearer + ADMIN |
| `/admin/apps/:slug/webhook-deliveries` | GET | `adminListWebhookDeliveries()` | Bearer + ADMIN |
| `/admin/apps/:slug/webhook-deliveries/:id` | GET | `adminGetWebhookDelivery()` | Bearer + ADMIN |
| `/admin/apps/:slug/webhook-deliveries/:id/retry` | POST | `adminRetryWebhookDelivery()` | Bearer + ADMIN |
