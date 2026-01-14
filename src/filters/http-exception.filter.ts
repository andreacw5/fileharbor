import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  BadRequestException
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly ignoredPaths: string[] = [
    '/favicon.ico',
    '/sw.js',
    '/workbox-e3490c72.js',
  ];

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = exception.message;
    let errors = null;

    // Extract validation errors if present
    if (exception instanceof BadRequestException && typeof exceptionResponse === 'object') {
      const res: any = exceptionResponse;
      message = res.message || message;
      errors = res.message || null;
    }

    if (this.ignoredPaths.includes(request.url)) {
      Logger.debug(`Ignoring ${request.url} request`);
      return;
    }

    this.logger.error(
      exception.message + ' exception raised on: ' + request.url,
    );

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
    });
  }
}
