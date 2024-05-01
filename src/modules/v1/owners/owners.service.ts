import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { Owner } from '@prisma/client';
import { CreateAnOwnerDto } from './dto/create-an-owner.dto';
import { UpdateAnOwnerDto } from './dto/update-an-owner.dto';

@Injectable()
class OwnersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Gets all owners
   * @param filters
   */
  async getAllOwners(filters: object): Promise<Owner[]> {
    return this.prisma.owner.findMany({
      where: filters,
    });
  }

  /**
   * Create a new owner
   * @param {CreateAnOwnerDto} data
   */
  async createAnOwner(data: CreateAnOwnerDto) {
    return this.prisma.owner.create({
      data: {
        name: data.name || '',
        externalId: data.externalId,
        domain: data.domain,
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
}

export default OwnersService;
