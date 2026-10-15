import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from '@heyatom/nest-common';
import { RenderBusyException } from './storage.service';

describe('exception filter with fileharbor exceptions', () => {
  const filter = new AllExceptionsFilter();

  const respond = (exception: unknown, url: string) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ method: 'GET', url, id: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return { res, body: JSON.parse(res.end.mock.calls[0][0]) };
  };

  it('tells clients to retry a full render queue after a second', () => {
    const { res, body } = respond(
      new RenderBusyException(),
      '/images/abc?width=800',
    );

    expect(res.statusCode).toBe(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '1');
    expect(body).toMatchObject({
      statusCode: 503,
      code: 'UNAVAILABLE',
      message: 'Image renderer busy, retry',
      requestId: 'req-1',
    });
  });

  // Bug 0.1: the old filter returned without a response on its ignore-list.
  it.each(['/favicon.ico', '/wp-admin/setup.php', '/.env'])(
    'answers scanner path %s instead of hanging',
    (url) => {
      const { res, body } = respond(new NotFoundException(), url);

      expect(res.statusCode).toBe(404);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(body.code).toBe('NOT_FOUND');
    },
  );
});
