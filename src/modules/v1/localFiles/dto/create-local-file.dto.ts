export class CreateLocalFileDto {
  externalId: string;
  domain: string;
  description?: string;
  tags?: string[];
  type?: string;
}
