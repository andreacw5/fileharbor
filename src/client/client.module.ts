import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientInitService } from './client-init.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ClientService, ClientInitService],
  exports: [ClientService],
})
export class ClientModule {}

