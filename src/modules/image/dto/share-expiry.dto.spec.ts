import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateShareLinkDto } from './create-share-link.dto';
import { CreateAlbumTokenDto } from '@/modules/album/dto/create-album-token.dto';

// Expiry caps on the X-API-Key surface (review 2026-10-30 §4.2)
describe('share expiry caps', () => {
  // Must match setupHttpApp's global pipe (@heyatom/nest-common), which doesn't export its options.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (metatype: any, body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype });
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  it('share link: accepts up to 365 days, refuses beyond', async () => {
    await expect(
      validate(CreateShareLinkDto, { expiresAt: inDays(364) }),
    ).resolves.toBeDefined();
    await expect(
      validate(CreateShareLinkDto, { expiresAt: inDays(400) }),
    ).rejects.toThrow(BadRequestException);
  });

  it('album token: refuses more than 365 days (1e15 used to be a 500)', async () => {
    await expect(
      validate(CreateAlbumTokenDto, { expiresInDays: 365 }),
    ).resolves.toBeDefined();
    await expect(
      validate(CreateAlbumTokenDto, { expiresInDays: 1e15 }),
    ).rejects.toThrow(BadRequestException);
  });
});
