import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
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
}
