import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ClientStatsResponseDto } from './dto/client-stats-response.dto';
import { randomBytes } from 'crypto';

// Every X-API-Key request validates its key: cache hits for a short while so a
// burst of requests costs one query. Only valid clients are cached (a bogus key
// can't grow the map), and any client update clears it on this instance; other
// replicas catch up within the TTL.
const CLIENT_CACHE_TTL_MS = 30_000;

const AUTH_CLIENT_SELECT = {
  id: true,
  name: true,
  domain: true,
  active: true,
} satisfies Prisma.ClientSelect;

export type AuthClient = Prisma.ClientGetPayload<{
  select: typeof AUTH_CLIENT_SELECT;
}>;

@Injectable()
export class ClientService {
  private readonly clientCache = new Map<
    string,
    { client: AuthClient; expiresAt: number }
  >();

  constructor(private prisma: PrismaService) {}

  /**
   * Validate client by API key
   */
  async validateClient(apiKey: string): Promise<AuthClient> {
    const cached = this.clientCache.get(apiKey);
    if (cached && cached.expiresAt > Date.now()) return cached.client;

    const client = await this.prisma.client.findUnique({
      where: { apiKey },
      select: AUTH_CLIENT_SELECT,
    });

    if (!client || !client.active) {
      this.clientCache.delete(apiKey);
      throw new UnauthorizedException('Invalid or inactive client');
    }

    this.clientCache.set(apiKey, {
      client,
      expiresAt: Date.now() + CLIENT_CACHE_TTL_MS,
    });
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
   * Create a new client and seed its default 'system' creator
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

    // System creator for images without explicit creatorId
    await this.prisma.creator.create({
      data: {
        clientId: client.id,
        externalId: 'system',
        username: 'system',
      },
    });

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
      totalCreators: c._count.creators,
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
      totalCreators: client._count.creators,
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
    this.clientCache.clear();

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
}
