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

  // Exact paths to ignore (case-sensitive)
  private readonly ignoredPaths: string[] = [
    '/favicon.ico',
    '/sw.js',
  ];

  // Pattern to match workbox files and other common browser requests
  // This prevents log pollution from legitimate browser requests for missing assets
  private readonly ignoredPatterns: RegExp[] = [
    // Service worker and PWA files
    /^\/workbox-[a-f0-9]+\.js$/,           // workbox files with hash
    /^\/sw\.js$/,                          // service worker
    /^\/manifest\.json$/,                  // PWA manifest
    /^\/.*\.webmanifest$/,                 // Web app manifest

    // Icons and favicons
    /^\/favicon\.(ico|png|jpg|svg)$/,      // favicon variants
    /^\/(apple-)?touch-icon.*\.(png|jpg)$/,// Apple touch icons
    /^\/icon-\d+x\d+\.(png|jpg|svg)$/,     // PWA icons
    /^\/apple-icon.*\.(png|jpg)$/,         // Apple icons
    /^\/android-icon.*\.(png|jpg)$/,       // Android icons
    /^\/mstile-.*\.(png|jpg)$/,            // Microsoft tile icons

    // Browser security files
    /^\/robots\.txt$/,                     // robots.txt
    /^\/sitemap\.xml$/,                    // sitemap
    /^\/security\.txt$/,                   // security.txt
    /^\/\.well-known\/.*$/,                // well-known directory
    /^\/humans\.txt$/,                     // humans.txt

    // Browser auto-requests
    /^\/browserconfig\.xml$/,              // IE/Edge browser config
    /^\/crossdomain\.xml$/,                // Flash crossdomain policy
    /^\/clientaccesspolicy\.xml$/,         // Silverlight policy

    // Development and build artifacts
    /^\/webpack-.*\.js$/,                  // webpack files
    /^\/.*\.hot-update\.js$/,              // webpack hot reload
    /^\/.*\.hot-update\.json$/,            // webpack hot reload
    /^\/.*\.map$/,                         // source maps

    // Common attack patterns (scanner bots)
    /^\/wp-.*$/,                           // WordPress paths
    /^\/admin.*$/,                         // admin paths (if not using /admin)
    /^\/phpmyadmin.*$/,                    // phpMyAdmin
    /^\/\.env$/,                           // .env file requests
    /^\/\.git\/.*$/,                       // git directory
    /^\/config\/.*$/,                      // config paths
    /^\/backup.*$/,                        // backup files
    /^\/.*\.(sql|bak|old|tmp|log)$/,       // sensitive file extensions

    // Mobile app assets
    /^\/app-ads\.txt$/,                    // app ads.txt
    /^\/assetlinks\.json$/,                // Android app links
    /^\/\.well-known\/assetlinks\.json$/,  // Android app links (well-known)
    /^\/\.well-known\/apple-app-site-association$/, // iOS app links

    // CDN and static assets commonly requested
    /^\/static\/.*$/,                      // static assets folder
    /^\/assets\/.*$/,                      // assets folder
    /^\/public\/.*$/,                      // public assets folder
    /^\/uploads\/.*$/,                     // uploads folder (if not serving)
    /^\/media\/.*$/,                       // media folder

    // Development tools and frameworks
    /^\/node_modules\/.*$/,                // Node.js modules
    /^\/vendor\/.*$/,                      // Vendor assets
    /^\/build\/.*$/,                       // Build artifacts
    /^\/dist\/.*$/,                        // Distribution files

    // Browser extension and addon requests
    /^\/chrome-extension\/.*$/,            // Chrome extensions
    /^\/moz-extension\/.*$/,               // Firefox extensions

    // Common CMS and framework paths
    /^\/administrator\/.*$/,               // Joomla admin
    /^\/typo3\/.*$/,                       // TYPO3 CMS
    /^\/drupal\/.*$/,                      // Drupal paths
    /^\/magento\/.*$/,                     // Magento paths

    // API documentation and health checks commonly probed
    /^\/health$/,                          // health check (if not implemented)
    /^\/ping$/,                            // ping endpoint
    /^\/version$/,                         // version endpoint
    /^\/info$/,                            // info endpoint
  ];

  /**
   * Check if a request is likely for a static asset based on file extension
   * This helps catch asset requests that don't match our patterns
   */
  private isLikelyAssetRequest(url: string): boolean {
    const assetExtensions = [
      '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
      '.webp', '.woff', '.woff2', '.ttf', '.eot', '.otf',
      '.mp3', '.mp4', '.webm', '.ogg', '.wav',
      '.pdf', '.zip', '.rar', '.tar', '.gz',
      '.xml', '.json', '.txt', '.md'
    ];

    const urlLower = url.toLowerCase();
    return assetExtensions.some(ext => urlLower.endsWith(ext));
  }

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

    // Get URL without query parameters for pattern matching
    const urlPath = request.url.split('?')[0];

    // Check exact paths first
    if (this.ignoredPaths.includes(urlPath)) {
      Logger.debug(`Ignoring ${urlPath} request`);
      return;
    }

    // Check patterns (also check the full URL with query params)
    if (this.ignoredPatterns.some(pattern => pattern.test(urlPath) || pattern.test(request.url))) {
      Logger.debug(`Ignoring ${urlPath} request (pattern match)`);
      return;
    }

    // Only log if it's a real application error (not 404s for assets)
    if (status === 404 && this.isLikelyAssetRequest(urlPath)) {
      Logger.debug(`Ignoring potential asset request: ${urlPath}`);
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
