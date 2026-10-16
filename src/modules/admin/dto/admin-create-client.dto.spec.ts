import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminCreateClientDto } from './admin-create-client.dto';

describe('AdminCreateClientDto.domain', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validate = (domain: string) =>
    pipe.transform(
      { name: 'x', domain },
      { type: 'body', metatype: AdminCreateClientDto },
    );

  it('accepts a hostname and lowercases it', async () => {
    await expect(validate('CDN.Example.com')).resolves.toMatchObject({
      domain: 'cdn.example.com',
    });
  });

  it.each([
    '3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c', // a client id: would alias its dir
    'defaults.fileharbor',
    '../etc',
    'a/b.com',
    'localhost',
  ])('rejects %s', async (domain) => {
    await expect(validate(domain)).rejects.toBeInstanceOf(BadRequestException);
  });
});
