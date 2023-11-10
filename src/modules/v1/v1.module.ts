import { Module } from '@nestjs/common';
import { Routes, RouterModule } from '@nestjs/core';

import { LocalFilesModule } from "./localFiles/localFiles.module";
import { UsersModule } from "./users/users.module";

const routes: Routes = [
    {
        path: '/v1',
        children: [
            { path: '/files', module: LocalFilesModule },
            { path: '/users', module: UsersModule },
        ],
    },
];

@Module({
    imports: [
        RouterModule.register(routes),
        LocalFilesModule,
        UsersModule,
    ],
})
export default class V1Module {}
