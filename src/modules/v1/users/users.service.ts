import LocalFilesService from "../localFiles/localFiles.service";
import {Injectable} from "@nestjs/common";
import { LocalFile } from '@prisma/client';

@Injectable()
export class UsersService {
    constructor(
        private localFilesService: LocalFilesService,
    ) {}

    async addAvatar(data: LocalFile) {
        const avatar = await this.localFilesService.saveFile(data);
        return avatar.id;
    }

    async optimizeImage(path: string) {
        return this.localFilesService.optimizeImage(path);
    }
}
