import { EventEmitter } from 'events';
import type { NextFunction, Request, Response } from 'express';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';

function makeReq(req: {
  method: string;
  path: string;
  route?: { path: string };
}): Request {
  return req as unknown as Request;
}

function makeRes(statusCode: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  res.statusCode = statusCode;
  return res;
}

describe('MetricsMiddleware', () => {
  let observe: jest.Mock;
  let middleware: MetricsMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    observe = jest.fn();
    middleware = new MetricsMiddleware({
      httpRequestDuration: { observe },
    } as unknown as MetricsService);
    next = jest.fn();
  });

  it('observes the route pattern and the final status on finish', () => {
    const req = makeReq({ method: 'GET', path: '/images/123' });
    const res = makeRes(200);

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();

    // Express sets req.route once the router matches, after the middleware ran.
    (req as { route?: { path: string } }).route = {
      path: '/images/:id',
    };
    res.statusCode = 200;
    res.emit('finish');

    expect(observe).toHaveBeenCalledTimes(1);
    const [labels, seconds] = observe.mock.calls[0];
    expect(labels).toEqual({
      method: 'GET',
      route: '/images/:id',
      status: '200',
    });
    expect(seconds).toBeGreaterThanOrEqual(0);
  });

  it('records a guard rejection: the route matched even though no handler ran', () => {
    const req = makeReq({
      method: 'GET',
      path: '/users',
    });
    const res = makeRes(401);

    middleware.use(req, res, next);
    (req as { route?: { path: string } }).route = { path: '/users' };
    res.emit('finish');

    expect(observe.mock.calls[0][0]).toMatchObject({
      route: '/users',
      status: '401',
    });
  });

  it('labels a request that matched no route as "unmatched"', () => {
    const req = makeReq({ method: 'GET', path: '/nope' });
    const res = makeRes(404);

    middleware.use(req, res, next);
    res.emit('finish');

    expect(observe.mock.calls[0][0]).toMatchObject({
      route: 'unmatched',
      status: '404',
    });
  });

  it('labels "unmatched" when req.route is still the catch-all the middleware is mounted on', () => {
    const mount = { path: '/{*splat}' };
    const req = makeReq({ method: 'GET', path: '/nope', route: mount });
    const res = makeRes(404);

    middleware.use(req, res, next);
    res.emit('finish');

    expect(observe.mock.calls[0][0]).toMatchObject({
      route: 'unmatched',
      status: '404',
    });
  });

  it('does not observe /health/*', () => {
    for (const path of ['/health/live', '/health/ready']) {
      const res = makeRes(200);
      middleware.use(makeReq({ method: 'GET', path }), res, next);
      res.emit('finish');
    }

    expect(observe).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });
});
