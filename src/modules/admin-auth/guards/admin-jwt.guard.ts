import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { BastionTokenVerifier, BastionJwtPayload } from '../bastion-token-verifier.service';

export interface AdminJwtPayload {
  // From Bastion JWT
  sub: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  username?: string;
  image?: string;
  role: string;
  appSlug: string;
  permissions: string[];
  // Enriched from local AdminUser
  adminUserId: string;
  allClientsAccess: boolean;
  allowedClientIds: string[];
}

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly tokenVerifier: BastionTokenVerifier,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const bastionPayload = await this.tokenVerifier.verifyAuthHeader(request.headers['authorization']);

    const adminUser = await this.prisma.adminUser.findUnique({
      where: { bastionUserId: bastionPayload.sub },
      include: { clientAccess: { select: { clientId: true } } },
    });

    if (!adminUser || !adminUser.active) {
      throw new UnauthorizedException('Admin access not granted');
    }

    (request as any).adminUser = {
      sub: bastionPayload.sub,
      tenantId: bastionPayload.tenantId,
      tenantSlug: bastionPayload.tenantSlug,
      email: bastionPayload.email,
      username: bastionPayload.username,
      image: bastionPayload.image,
      role: bastionPayload.role,
      appSlug: bastionPayload.appSlug,
      permissions: bastionPayload.permissions ?? [],
      adminUserId: adminUser.id,
      allClientsAccess: adminUser.allClientsAccess,
      allowedClientIds: adminUser.clientAccess.map((a) => a.clientId),
    } satisfies AdminJwtPayload;

    // fire-and-forget UserCache upsert — keeps cached Bastion profile data fresh
    this.upsertUserCache(bastionPayload).catch(() => undefined);

    return true;
  }

  private async upsertUserCache(payload: BastionJwtPayload): Promise<void> {
    await this.prisma.userCache.upsert({
      where: { id: payload.sub },
      create: {
        id: payload.sub,
        username: payload.username ?? null,
        email: payload.email,
        image: payload.image ?? null,
      },
      update: {
        username: payload.username ?? null,
        email: payload.email,
        image: payload.image ?? null,
      },
    });
  }
}
