import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AvatarService } from '@/modules/avatar/avatar.service';
import {
  AvatarResponseDto,
  DeleteAvatarResponseDto,
} from '@/modules/avatar/dto';
import { Client } from '@prisma/client';
import { MeAvatarStatusDto } from './dto';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly avatarService: AvatarService,
  ) {}

  /**
   * Resolves the FileHarbor client mapped to a Bastion tenant slug, for
   * self-service (user-JWT) endpoints. Returns null when no ACTIVE client is
   * mapped — self-service avatars are opt-in per client via
   * Client.bastionTenantSlug, and clients without a mapping (e.g. a
   * "personal" client) never get self-service avatars.
   */
  async resolveClient(tenantSlug: string): Promise<Client | null> {
    const client = await this.prisma.client.findUnique({
      where: { bastionTenantSlug: tenantSlug },
    });
    if (!client || !client.active) return null;
    return client;
  }

  private async requireClient(tenantSlug: string): Promise<Client> {
    const client = await this.resolveClient(tenantSlug);
    if (!client) {
      throw new UnprocessableEntityException(
        'No FileHarbor client mapped to this tenant',
      );
    }
    return client;
  }

  /**
   * `enabled` reflects whether the tenant is mapped at all — the avatar itself
   * is null (not a 404) when the user simply hasn't uploaded one yet.
   */
  async getAvatar(tenantSlug: string, sub: string): Promise<MeAvatarStatusDto> {
    const client = await this.resolveClient(tenantSlug);
    if (!client) {
      return { enabled: false, avatar: null };
    }

    try {
      const avatar = await this.avatarService.getAvatarByExternalUserId(sub);
      return {
        enabled: true,
        avatar: this.avatarService.getAvatarMetadata(avatar, sub),
      };
    } catch {
      // No user record yet, or no avatar uploaded — not an error for a status check.
      return { enabled: true, avatar: null };
    }
  }

  async uploadAvatar(
    tenantSlug: string,
    sub: string,
    file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    const client = await this.requireClient(tenantSlug);
    this.logger.log(
      `[uploadAvatar] Self-service upload - tenant: ${tenantSlug}, client: ${client.id}`,
    );
    return this.avatarService.uploadAvatar(client.id, file, sub);
  }

  async deleteAvatar(
    tenantSlug: string,
    sub: string,
  ): Promise<DeleteAvatarResponseDto> {
    const client = await this.requireClient(tenantSlug);
    this.logger.log(
      `[deleteAvatar] Self-service delete - tenant: ${tenantSlug}, client: ${client.id}`,
    );
    return this.avatarService.deleteAvatar(client.id, sub);
  }
}
