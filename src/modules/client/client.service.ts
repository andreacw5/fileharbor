import { Injectable, UnauthorizedException } from '@nestjs/common';
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
   * Get or create user for client
   */
  async getOrCreateUser(
    clientId: string,
    externalUserId: string,
    email?: string,
    username?: string,
  ) {
    return this.prisma.user.upsert({
      where: {
        clientId_externalUserId: {
          clientId,
          externalUserId,
        },
      },
      update: {
        email: email || undefined,
        username: username || undefined,
      },
      create: {
        clientId,
        externalUserId,
        email,
        username,
      },
    });
  }

  /**
   * Get user by external ID
   */
  async getUserByExternalId(clientId: string, externalUserId: string) {
    return this.prisma.user.findUnique({
      where: {
        clientId_externalUserId: {
          clientId,
          externalUserId,
        },
      },
    });
  }

  /**
   * Create a new client and ensure a default admin user exists if no users are present
   */
  async createClient(data: { name: string; domain?: string; active?: boolean }) {
    // Generate secure API key
    const apiKey = this.generateApiKey();

    // Create the client
    const client = await this.prisma.client.create({
      data: {
        name: data.name,
        apiKey,
        domain: data.domain,
        active: data.active ?? true,
      },
    });

    // Check if users exist for this client
    const userCount = await this.prisma.user.count({
      where: { clientId: client.id },
    });

    // If no users, create default users
    if (userCount === 0) {
      // Create administrator user
      await this.prisma.user.create({
        data: {
          clientId: client.id,
          externalUserId: 'administrator',
          username: 'administrator',
        },
      });

      // Create system user for images without explicit userId
      await this.prisma.user.create({
        data: {
          clientId: client.id,
          externalUserId: 'system',
          username: 'system',
        },
      });
    }

    return client;
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
    const [totalImages, totalAlbums, totalStorage, uploadedLast7Days] = await Promise.all([
      this.prisma.image.count({ where: { clientId } }),
      this.prisma.album.count({ where: { clientId } }),
      this.prisma.image.aggregate({
        where: { clientId },
        _sum: { size: true },
      }),
      this.prisma.image.count({
        where: { clientId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
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
   * `allowed` is null for unrestricted admins, or an array of clientIds.
   */
  async listClientsWithStats(allowed: string[] | null) {
    const where = allowed !== null ? { id: { in: allowed } } : {};

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { images: true, avatars: true, albums: true } },
      },
    });

    const storagePerClient = await this.prisma.image.groupBy({
      by: ['clientId'],
      where: allowed !== null ? { clientId: { in: allowed } } : undefined,
      _sum: { size: true },
    });

    const storageMap = new Map(storagePerClient.map((s) => [s.clientId, s._sum.size || 0]));

    return clients.map((c) => ({
      ...c,
      totalImages: c._count.images,
      totalAvatars: c._count.avatars,
      totalAlbums: c._count.albums,
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
      include: { _count: { select: { images: true, avatars: true, albums: true } } },
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
      totalStorage: storageAgg._sum.size || 0,
    };
  }

  /**
   * Update arbitrary client fields and return the enriched result (admin use).
   */
  async updateClientWithStats(clientId: string, data: Record<string, any>) {
    const updated = await this.prisma.client.update({
      where: { id: clientId },
      data,
      include: { _count: { select: { images: true, avatars: true, albums: true } } },
    });

    const storageAgg = await this.prisma.image.aggregate({
      where: { clientId },
      _sum: { size: true },
    });

    return {
      ...updated,
      totalImages: updated._count.images,
      totalAvatars: updated._count.avatars,
      totalAlbums: updated._count.albums,
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
