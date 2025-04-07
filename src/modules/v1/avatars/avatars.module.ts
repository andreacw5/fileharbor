import { forwardRef, Module } from '@nestjs/common';
import { AvatarsService } from './avatars.service';
import { AvatarsController } from './avatars.controller';
import { PrismaService } from '../../../prisma.service';
import { OwnersModule } from '../owners/owners.module';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [
    OwnersModule,
    forwardRef(() => AssetsModule),
  ],
  providers: [AvatarsService, PrismaService],
  controllers: [AvatarsController],
  exports: [AvatarsService],
})
export class AvatarsModule {}
