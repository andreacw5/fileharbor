import { ArgumentsHost, ServiceUnavailableException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { RenderBusyException } from '@/modules/storage/storage.service';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  const respond = (exception: ServiceUnavailableException) => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/images/abc?width=800' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return response;
  };

  it('tells clients to retry a full render queue after a second', () => {
    const response = respond(new RenderBusyException());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '1');
  });

  it('adds no Retry-After to other 503s', () => {
    const response = respond(new ServiceUnavailableException());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
