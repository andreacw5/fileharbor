import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ClientStatsResponseDto } from './dto/client-stats-response.dto';
import { GlobalStatsResponseDto } from './dto/global-stats-response.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class ClientService {
  constructor(private prisma: PrismaService) {}

  /**
   * Validate client by API key
   */
  async validateClient(apiKey: string) {
    const client = await this.prisma.client.findUnique({
      where: { apiKey },
    });

    if (!client || !client.active) {
      throw new UnauthorizedException('Invalid or inactive client');
    }

    return client;
  }

  /**
   * Get client by ID
   */
  async getClientById(clientId: string) {
    return this.prisma.client.findUnique({
      where: { id: clientId },
    });
  }

  /**
   * Get or create creator for client
   */
  async getOrCreateUser(
    clientId: string,
    externalId: string,
    email?: string,
    username?: string,
  ) {
    return this.prisma.creator.upsert({
      where: {
        clientId_externalId: {
          clientId,
          externalId,
        },
      },
      update: {
        email: email || undefined,
        username: username || undefined,
      },
      create: {
        clientId,
        externalId,
        email,
        username,
      },
    });
  }

  /**
   * Get creator by external ID
   */
  async getUserByExternalId(clientId: string, externalId: string) {
    return this.prisma.creator.findUnique({
      where: {
        clientId_externalId: {
          clientId,
          externalId,
        },
      },
    });
  }

  /**
   * Create a new client and seed its default 'administrator' and 'system' creators
   */
  async createClient(data: {
    name: string;
    domain?: string | null;
    active?: boolean;
    bastionTenantSlug?: string | null;
  }) {
    // Generate secure API key
    const apiKey = this.generateApiKey();

    // Create the client
    let client;
    try {
      client = await this.prisma.client.create({
        data: {
          name: data.name,
          apiKey,
          domain: data.domain,
          active: data.active ?? true,
          bastionTenantSlug: data.bastionTenantSlug,
        },
      });
    } catch (error) {
      this.mapUniqueConstraintViolation(error);
    }

    // Check if creators exist for this client
    const creatorCount = await this.prisma.creator.count({
      where: { clientId: client.id },
    });

    // If no creators, create default creators
    if (creatorCount === 0) {
      // Create administrator creator
      await this.prisma.creator.create({
        data: {
          clientId: client.id,
          externalId: 'administrator',
          username: 'administrator',
        },
      });

      // Create system creator for images without explicit creatorId
      await this.prisma.creator.create({
        data: {
          clientId: client.id,
          externalId: 'system',
          username: 'system',
        },
      });
    }

    return client;
  }

  /**
   * Maps a Prisma unique-constraint violation (P2002) on a known client field to a
   * ConflictException with a creator-facing message. `meta.target` is normally a string[]
   * of field names, but with Prisma 7 driver adapters it can also be absent or a single
   * string (sometimes the constraint name rather than the bare field name) — handled
   * defensively here. Any other error (or an unrecognized target) is rethrown unchanged.
   */
  private mapUniqueConstraintViolation(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const rawTarget = error.meta?.target;
      const targets: string[] = Array.isArray(rawTarget)
        ? rawTarget
        : typeof rawTarget === 'string'
          ? [rawTarget]
          : [];

      const messages: Record<string, string> = {
        bastionTenantSlug: 'Tenant slug already mapped to another client',
        domain: 'Domain already used by another client',
      };

      for (const [field, message] of Object.entries(messages)) {
        if (targets.some((t) => t === field || t.includes(field))) {
          throw new ConflictException(message);
        }
      }
    }
    throw error;
  }

  /**
   * Generate a secure random API key
   * Format: fh_[48 random hex chars]_[timestamp]
   * Total length: ~60+ characters
   */
  private generateApiKey(): string {
    // Generate 24 bytes (48 hex characters) of random data
    const randomPart = randomBytes(24).toString('hex');
    const timestamp = Date.now().toString(36); // Compact timestamp representation
    return `fh_${randomPart}_${timestamp}`;
  }

  /**
   * Get aggregated statistics for a client
   */
  async getStats(clientId: string): Promise<ClientStatsResponseDto> {
    const [totalImages, totalAlbums, totalStorage, uploadedLast7Days] =
      await Promise.all([
        this.prisma.image.count({ where: { clientId } }),
        this.prisma.album.count({ where: { clientId } }),
        this.prisma.image.aggregate({
          where: { clientId },
          _sum: { size: true },
        }),
        this.prisma.image.count({
          where: {
            clientId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    return {
      totalImages,
      totalAlbums,
      totalStorage: totalStorage._sum.size || 0,
      uploadedLast7Days,
    };
  }

  /**
   * List all clients enriched with entity counts and total storage (admin use).
   * `allowed` is the clientIds the caller may see, resolved by `AdminJwtGuard`.
   */
  async listClientsWithStats(allowed: string[]) {
    // Always an explicit list: no role grants blanket client access any more,
    // so an empty list legitimately means "nothing to show".
    const where = { id: { in: allowed } };

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            images: true,
            avatars: true,
            albums: true,
            videos: true,
            creators: true,
          },
        },
      },
    });

    const storagePerClient = await this.prisma.image.groupBy({
      by: ['clientId'],
      where: allowed !== null ? { clientId: { in: allowed } } : undefined,
      _sum: { size: true },
    });

    const storageMap = new Map(
      storagePerClient.map((s) => [s.clientId, s._sum.size || 0]),
    );

    return clients.map((c) => ({
      ...c,
      totalImages: c._count.images,
      totalAvatars: c._count.avatars,
      totalAlbums: c._count.albums,
      totalVideos: c._count.videos,
      totalUsers: c._count.creators,
      totalStorage: storageMap.get(c.id) || 0,
    }));
  }

  /**
   * Get a single client enriched with entity counts and storage.
   * Returns null if not found.
   */
  async getClientWithStats(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        _count: {
          select: {
            images: true,
            avatars: true,
            albums: true,
            videos: true,
            creators: true,
          },
        },
      },
    });

    if (!client) return null;

    const storageAgg = await this.prisma.image.aggregate({
      where: { clientId },
      _sum: { size: true },
    });

    return {
      ...client,
      totalImages: client._count.images,
      totalAvatars: client._count.avatars,
      totalAlbums: client._count.albums,
      totalVideos: client._count.videos,
      totalUsers: client._count.creators,
      totalStorage: storageAgg._sum.size || 0,
    };
  }

  /**
   * Update arbitrary client fields and return the enriched result (admin use).
   */
  async updateClientWithStats(clientId: string, data: Record<string, any>) {
    let updated;
    try {
      updated = await this.prisma.client.update({
        where: { id: clientId },
        data,
        include: {
          _count: {
            select: { images: true, avatars: true, albums: true, videos: true },
          },
        },
      });
    } catch (error) {
      this.mapUniqueConstraintViolation(error);
    }

    const storageAgg = await this.prisma.image.aggregate({
      where: { clientId },
      _sum: { size: true },
    });

    return {
      ...updated,
      totalImages: updated._count.images,
      totalAvatars: updated._count.avatars,
      totalAlbums: updated._count.albums,
      totalVideos: updated._count.videos,
      totalStorage: storageAgg._sum.size || 0,
    };
  }

  /**
   * Get aggregated statistics across ALL clients (admin use only)
   */
  async getGlobalStats(): Promise<GlobalStatsResponseDto> {
    const [totalImages, totalStorage] = await Promise.all([
      this.prisma.image.count(),
      this.prisma.image.aggregate({ _sum: { size: true } }),
    ]);

    return {
      totalImages,
      totalStorage: totalStorage._sum.size || 0,
    };
  }
}
