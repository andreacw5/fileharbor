import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { MetricsService } from './metrics.service';

/**
 * Serves `GET /metrics` on its own port (`METRICS_PORT`, default 9091),
 * outside the Nest/Express app: no guards, no throttler, no CORS, and no
 * route on the public API port at all. Isolation is the network's job —
 * nginx never proxies this port and the container must not publish it; only
 * the scraper on the internal Docker network reaches it.
 */
@Injectable()
export class MetricsServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MetricsServer.name);
  private server: Server | undefined;

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): Promise<void> {
    const port = this.config.getOrThrow<number>('metricsPort');
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      this.metrics.registry.metrics().then(
        (body) => {
          res.writeHead(200, {
            'Content-Type': this.metrics.registry.contentType,
          });
          res.end(body);
        },
        (err: unknown) => {
          this.logger.error(
            `metrics scrape failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          res.writeHead(500).end();
        },
      );
    });
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject).listen(port, () => {
        this.logger.log(`metrics listening on port ${port}`);
        resolve();
      });
    });
  }

  onApplicationShutdown(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  /** Bound port — tests listen on 0 and read the real one back. */
  get port(): number | undefined {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr ? addr.port : undefined;
  }
}
