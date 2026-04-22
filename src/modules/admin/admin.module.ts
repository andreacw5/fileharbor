import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminInitService } from './admin-init.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { StorageModule } from '@/modules/storage/storage.module';
import { ImageModule } from '@/modules/image/image.module';
import { AvatarModule } from '@/modules/avatar/avatar.module';
import { AlbumModule } from '@/modules/album/album.module';
import { ClientModule } from '@/modules/client/client.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    ImageModule,
    AvatarModule,
    AlbumModule,
    ClientModule,
    ConfigModule,
    JwtModule.register({}),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminInitService, AdminJwtGuard],
  exports: [],
})
export class AdminModule {}



