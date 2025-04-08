import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { AvatarDto } from './dto/avatar.dto';

@Injectable()
export class AvatarsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Gets all avatars
   * @param filters
   */
  async getAllAvatars(filters: object) {
    return this.prisma.avatar.findMany({
      where: filters,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            domain: true,
            externalId: true,
          },
        },
      },
    });
  }

  /**
   * Gets an avatar by its id
   * @param {String} id
   */
  async getAvatarById(id: string) {
    return this.prisma.avatar.findUnique({
      where: { id },
    });
  }

  /**
   * Updates the views of a file by its id
   * @param id
   */
  async updateViews(id: string) {
    return this.prisma.avatar.update({
      where: { id },
      data: {
        views: {
          increment: 1,
        },
      },
    });
  }

  async updateAvatar(id: string, data: object) {
    return this.prisma.avatar.update({
      where: { id },
      data,
    });
  }

  /**
   * Saves a file to the database
   * @param data
   */
  async createAnAvatar(data: AvatarDto) {
    return this.prisma.avatar.create({
      data: {
        ...data,
      },
    });
  }

  /**
   * Deletes an avatar by its id
   * @param id
   */
  async deleteAvatarById(id: string) {
    return this.prisma.avatar.delete({ where: { id } });
  }
}
