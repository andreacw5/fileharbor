import { Exclude } from 'class-transformer';
import { OwnerDto } from '../../owners/dto/owner.dto';

export class LocalFileDto {
  id: string;
  filename: string;
  path: string;
  mimetype: string;
  size: number;
  @Exclude()
  ownerId: string;
  description: string;
  type: string;
  tags: string[];
  views: number;
  downloads: number;
  optimized: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner: OwnerDto;

  @Exclude()
  token: string;
}
