import { contentDisposition } from './content-disposition';

describe('contentDisposition', () => {
  it('cannot be broken out of with quotes or line breaks', () => {
    const header = contentDisposition('a".html"\r\nX-Evil: 1');
    expect(header).toBe(
      `attachment; filename="a_.html___X-Evil: 1"; filename*=UTF-8''a%22.html%22%0D%0AX-Evil%3A%201`,
    );
  });

  it('keeps a non-ASCII name in filename*', () => {
    expect(contentDisposition("città (1)'.jpg", 'inline')).toBe(
      `inline; filename="citt_ (1)'.jpg"; filename*=UTF-8''citt%C3%A0%20%281%29%27.jpg`,
    );
  });
});
