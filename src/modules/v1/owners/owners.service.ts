import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CreateAnOwnerDto } from './dto/create-an-owner.dto';
import { UpdateAnOwnerDto } from './dto/update-an-owner.dto';
import generator from 'generate-password-ts';
import { AuthService } from '../auth/auth.service';

@Injectable()
class OwnersService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  /**
   * Gets all owners
   * @param filters
   */
  async getAllOwners(filters: object) {
    return this.prisma.owner.findMany({
      where: filters,
      select: {
        id: true,
        name: true,
        externalId: true,
        domain: true,
      },
    });
  }

  /**
   * Create a new owner
   * @param {CreateAnOwnerDto} data
   */
  async createAnOwner(data: CreateAnOwnerDto) {
    const password = await this.authService.generateAPassword();
    return this.prisma.owner.create({
      data: {
        name: data.name || '',
        externalId: data.externalId,
        domain: data.domain,
        password: password,
      },
    });
  }

  /**
   * Gets an owner by its id
   * @param {string} id
   */
  async getOwnerById(id: string) {
    return this.prisma.owner.findUnique({ where: { id: id } });
  }

  /**
   * Gets an owner by its external id and domain
   * @param {string} externalId
   * @param {string} domain
   */
  async getOwnerByExternalIdAndDomain(externalId: string, domain: string) {
    return this.prisma.owner.findUnique({
      where: {
        // @ts-ignore
        externalId_domain: {
          externalId: externalId,
          domain: domain,
        },
      },
    });
  }

  /**
   * Updates an owner by its id
   * @param {string} id
   * @param {UpdateAnOwnerDto} data
   */
  async updateAnOwner(id: string, data: UpdateAnOwnerDto) {
    return this.prisma.owner.update({
      where: { id },
      data: {
        name: data.name || '',
      },
    });
  }

  /**
   * Deletes an owner by its id
   * @param {string} id
   */
  async deleteAnOwner(id: string) {
    return this.prisma.owner.delete({ where: { id } });
  }

  /**
   * Gets an owner by its external id and domain or creates a new one
   * @param {CreateAnOwnerDto} data
   */
  async getOwnerOrCreate(data: CreateAnOwnerDto) {
    if (!data.externalId || !data.domain) {
      throw new BadRequestException('No external id or domain provided');
    }
    const owner = await this.getOwnerByExternalIdAndDomain(
      data.externalId,
      data.domain,
    );
    if (owner) {
      return owner;
    }
    return this.createAnOwner(data);
  }
}

export default OwnersService;
