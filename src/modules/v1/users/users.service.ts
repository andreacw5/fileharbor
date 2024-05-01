import LocalFilesService from '../localFiles/localFiles.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private localFilesService: LocalFilesService) {}

  /**
   * Adds a file to the database
   * @param file
   * @param description
   * @param tags
   * @param ownerId
   */
  async addFile(
    file: Express.Multer.File,
    description: string,
    tags: string[],
    ownerId: string,
  ) {
    return await this.localFilesService.saveFile({
      id: file.filename,
      path: file.path,
      filename: file.originalname,
      size: file.size,
      ownerId: ownerId,
      mimetype: 'image/webp',
      description,
      type: 'avatar',
      tags,
    });
  }
}
