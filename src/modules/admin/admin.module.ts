import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminInitService } from './admin-init.service';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { StorageModule } from '@/modules/storage/storage.module';
import { ImageModule } from '@/modules/image/image.module';
import { AvatarModule } from '@/modules/avatar/avatar.module';
import { AlbumModule } from '@/modules/album/album.module';
import { ClientModule } from '@/modules/client/client.module';
import { UserModule } from '@/modules/user/user.module';
import { AdminAuthModule } from '@/modules/admin-auth/admin-auth.module';

// Controllers
import { ClientsAdminController } from './controllers/clients-admin.controller';
import { ImagesAdminController } from './controllers/images-admin.controller';
import { AvatarsAdminController } from './controllers/avatars-admin.controller';
import { AlbumsAdminController } from './controllers/albums-admin.controller';
import { UsersAdminController } from './controllers/users-admin.controller';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    ImageModule,
    AvatarModule,
    AlbumModule,
    ClientModule,
    UserModule,
    ConfigModule,
    AdminAuthModule,
  ],
  controllers: [
    ClientsAdminController,
    ImagesAdminController,
    AvatarsAdminController,
    AlbumsAdminController,
    UsersAdminController,
  ],
  providers: [AdminInitService],
  exports: [],
})
export class AdminModule {}
