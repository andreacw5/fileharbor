import { Injectable, OnModuleInit } from '@nestjs/common';
// @ts-error Prisma generate types are not up to date
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    // @ts-error Prisma generate types are not up to date
    await this.$connect();
  }
}
