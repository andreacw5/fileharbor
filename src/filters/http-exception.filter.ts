import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Check if it's a 404 (Not Found) and the request looks like a bot scan
    if (exception instanceof NotFoundException) {
      const botPatterns = [
        /favicon.ico/i,
        /wp-includes/i,
        /xmlrpc.php/i,
        /wp-/i,
        /cms/i,
        /test/i,
        /wordpress/i,
        /.git/i,
      ];
      if (botPatterns.some((pattern) => pattern.test(request.url))) {
        // Silently return 404
        return response.status(HttpStatus.NOT_FOUND).json({
          code: HttpStatus.NOT_FOUND,
          message: 'Not Found',
        });
      }
    }

    // Handle other exceptions normally
    this.logger.error(
      exception.message + ' exception raised on: ' + request.url,
    );
    response.status(exception.getStatus()).json({
      statusCode: exception.getStatus(),
      message: exception.message,
    });
  }
}
