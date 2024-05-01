import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { LocalFilesModule } from '../localFiles/localFiles.module';
import { OwnersModule } from '../owners/owners.module';

@Module({
  imports: [LocalFilesModule, OwnersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
