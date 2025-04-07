import { Module } from '@nestjs/common';
import { Routes, RouterModule } from '@nestjs/core';

import { OwnersModule } from './owners/owners.module';
import { FilesModule } from './files/files.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssetsModule } from './assets/assets.module';
import { AvatarsModule } from './avatars/avatars.module';

const routes: Routes = [
  {
    path: '/v1',
    children: [
      { path: '/avatars', module: AvatarsModule },
      { path: '/owners', module: OwnersModule },
      { path: '/stats', module: AnalyticsModule },
    ],
  },
];

@Module({
  imports: [
    RouterModule.register(routes),
    FilesModule,
    AvatarsModule,
    OwnersModule,
    AnalyticsModule,
    AssetsModule
  ],
})
export default class V1Module {}
