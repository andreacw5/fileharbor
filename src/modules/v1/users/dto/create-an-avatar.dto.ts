export class CreateAnAvatarDto {
  externalId: string;
  domain: string;
  description?: string;
  tags?: string[];
  type?: string;
}
