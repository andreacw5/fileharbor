import { ConfigService } from '@nestjs/config';
import { MetricsServer } from './metrics.server';
import { MetricsService } from './metrics.service';

describe('MetricsServer', () => {
  let server: MetricsServer;
  let base: string;

  beforeAll(async () => {
    const metrics = {
      registry: {
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        metrics: jest.fn().mockResolvedValue('# HELP fake\nfake 1\n'),
      },
    } as unknown as MetricsService;
    const config = { getOrThrow: () => 0 } as unknown as ConfigService;
    server = new MetricsServer(metrics, config);
    await server.onApplicationBootstrap();
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => server.onApplicationShutdown());

  it('serves the registry with its Content-Type on GET /metrics', async () => {
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
    expect(await res.text()).toBe('# HELP fake\nfake 1\n');
  });

  it('404s any other path or method', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(
      404,
    );
  });
});
