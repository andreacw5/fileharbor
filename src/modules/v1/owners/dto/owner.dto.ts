import { Exclude } from 'class-transformer';

export class OwnerDto {
  id: string;
  name: string;
  @Exclude()
  email: string;
  externalId: string;
  domain: string;
  @Exclude()
  password: string;
  createdAt: Date;
  updatedAt: Date;
}
