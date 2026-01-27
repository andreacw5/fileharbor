import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientInitService } from './client-init.service';
import { ClientController } from './client.controller';
import { PrismaModule } from '@/modules/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClientController],
  providers: [ClientService, ClientInitService],
  exports: [ClientService],
})
export class ClientModule {}

