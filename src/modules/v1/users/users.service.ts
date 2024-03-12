import LocalFilesService from '../localFiles/localFiles.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private localFilesService: LocalFilesService) {}

  async addAvatar(data: {
    path: string;
    filename: string;
    description: string;
    mimetype: string;
    id: string;
  }) {
    const avatar = await this.localFilesService.saveFile(data);
    return avatar.id;
  }
}
