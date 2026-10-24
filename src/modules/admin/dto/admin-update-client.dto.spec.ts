import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminUpdateClientDto } from './admin-update-client.dto';

// The webhook fields are gone (plan 10). With nest-common's pipe they are a 400,
// not a silent strip: Meridian must stop sending them before this deploys.
describe('AdminUpdateClientDto', () => {
  // Must match setupHttpApp's global pipe (@heyatom/nest-common), which doesn't export its options.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: AdminUpdateClientDto });

  it('accepts a plain update', async () => {
    await expect(validate({ name: 'x' })).resolves.toMatchObject({ name: 'x' });
  });

  it.each(['webhookEnabled', 'webhookUrl'])('rejects %s', async (field) => {
    await expect(validate({ name: 'x', [field]: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
