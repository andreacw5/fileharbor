import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    // Log incoming request
    this.logger.log(
      `Incoming: ${method} ${originalUrl} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}`
    );

    // Capture response finish event
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length') || '0';
      const duration = Date.now() - startTime;

      // Different log levels based on status code
      const logMessage = `Response: ${method} ${originalUrl} - Status: ${statusCode} - Size: ${contentLength} bytes - Duration: ${duration}ms`;

      if (statusCode >= 500) {
        this.logger.error(logMessage);
      } else if (statusCode >= 400) {
        this.logger.warn(logMessage);
      } else {
        this.logger.log(logMessage);
      }

      // Additional detailed logging for image endpoints
      if (originalUrl.includes('/images/')) {
        const imageId = originalUrl.match(/\/images\/([^/?]+)/)?.[1];
        const queryParams = req.query;

        this.logger.verbose(
          `Image Request: ImageId: ${imageId}, Query: ${JSON.stringify(queryParams)}, Status: ${statusCode}, Size: ${contentLength} bytes, Duration: ${duration}ms`
        );
      }
    });

    // Capture response close event (for early disconnections)
    res.on('close', () => {
      if (!res.writableEnded) {
        const duration = Date.now() - startTime;
        this.logger.warn(
          `Connection closed: ${method} ${originalUrl} - Duration: ${duration}ms (client disconnected)`
        );
      }
    });

    next();
  }
}

