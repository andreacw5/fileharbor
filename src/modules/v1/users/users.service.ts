import LocalFilesService from '../localFiles/localFiles.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private localFilesService: LocalFilesService) {}

  /**
   * Adds a file to the database
   * @param file
   * @param description
   */
  async addFile(file: Express.Multer.File, description: string) {
    return await this.localFilesService.saveFile({
      id: file.filename,
      path: file.path,
      filename: file.originalname,
      mimetype: 'image/webp',
      description,
    });
  }
}
