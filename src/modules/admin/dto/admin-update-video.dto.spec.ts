import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminUpdateVideoDto } from './admin-update-video.dto';

// PATCH /admin/videos/:id used an inline body type: the ValidationPipe checked nothing.
describe('AdminUpdateVideoDto', () => {
  // Must match setupHttpApp's global pipe (@heyatom/nest-common), which doesn't export its options.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: AdminUpdateVideoDto });

  it('accepts a plain update, null description included', async () => {
    await expect(
      validate({ originalName: 'a.mp4', tags: ['x'], description: null }),
    ).resolves.toMatchObject({ originalName: 'a.mp4', tags: ['x'] });
  });

  it.each([
    ['tags as a string', { tags: 'abc' }],
    ['an unbounded originalName', { originalName: 'x'.repeat(256) }],
    ['a non-boolean isPrivate', { isPrivate: 'yes' }],
    ['an unknown field', { views: 0 }],
  ])('rejects %s', async (_label, body) => {
    await expect(validate(body)).rejects.toThrow(BadRequestException);
  });
});
