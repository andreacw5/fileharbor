import { Module } from '@nestjs/common';
import { Routes, RouterModule } from '@nestjs/core';

import { LocalFilesModule } from './localFiles/localFiles.module';
import { UsersModule } from './users/users.module';
import { OwnersModule } from './owners/owners.module';

const routes: Routes = [
  {
    path: '/v1',
    children: [
      { path: '/files', module: LocalFilesModule },
      { path: '/users', module: UsersModule },
      { path: '/owners', module: OwnersModule },
    ],
  },
];

@Module({
  imports: [
    RouterModule.register(routes),
    LocalFilesModule,
    UsersModule,
    OwnersModule,
  ],
})
export default class V1Module {}
