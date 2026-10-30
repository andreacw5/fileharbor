import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  NestInterceptor,
} from '@nestjs/common';
import { diskStorage } from 'multer';
import { unlink } from 'fs/promises';
import { finalize } from 'rxjs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { contentDisposition } from '@/utils/content-disposition';

/** Multer options shared by the client and admin MP4 upload routes. */
export const videoMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.mp4.tmp`),
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (file.mimetype !== 'video/mp4') {
      return cb(new BadRequestException('Only MP4 files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: parseInt(process.env.MAX_VIDEO_SIZE || '524288000') },
};

/**
 * Deletes multer's temp file once the request is over, however it ended. Multer
 * writes up to MAX_VIDEO_SIZE to disk before the handler runs, so a 400 from the
 * ValidationPipe or an admin 403 would otherwise leave it in the tmpdir.
 * `VideoService.uploadVideo` unlinks it too on its own path; this covers the rest.
 * List it before the FileInterceptor, so it wraps it.
 */
export const removeVideoTempFile = {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context
      .switchToHttp()
      .getRequest<{ file?: { path?: string } }>();
    return next.handle().pipe(
      finalize(() => {
        if (req.file?.path) void unlink(req.file.path).catch(() => {});
      }),
    );
  },
} satisfies NestInterceptor;

/**
 * Sends an MP4, with Range support, for the client and admin stream routes.
 *
 * X-Accel-Redirect is opt-in, not inferred from NODE_ENV: it delegates delivery to
 * nginx and sends an empty body, which only works behind an nginx that declares
 * the `/internal-videos/` internal location. Everywhere else the caller gets
 * `video/mp4` with zero bytes and the player reports an unsupported format.
 *
 * The flag is global but the caller is not: Meridian's BFF reaches the container
 * on the Docker network, nginx never in between. So the hand-off also needs
 * `X-Original-URI`, which our nginx sets on every proxied location and no
 * internal caller forwards; without it the file is sent from here.
 */
export function sendVideo(
  res: Response,
  video: { storagePath: string; filePath: string; originalName: string },
  opts: {
    download: boolean;
    xAccelRedirect: boolean;
    /** Sent as-is; omitted (no Cache-Control at all) for admin private streams. */
    cacheControl?: string;
  },
): void {
  const xAccel = opts.xAccelRedirect && !!res.req?.headers['x-original-uri'];
  if (
    xAccel &&
    (video.storagePath.includes('..') || video.storagePath.startsWith('/'))
  ) {
    throw new ForbiddenException('Invalid storage path');
  }

  res.set({
    'Content-Type': 'video/mp4',
    'Content-Disposition': contentDisposition(
      video.originalName,
      opts.download ? 'attachment' : 'inline',
    ),
    ...(opts.cacheControl && { 'Cache-Control': opts.cacheControl }),
  });

  if (xAccel) {
    res.set(
      'X-Accel-Redirect',
      `/internal-videos/${video.storagePath}/original.mp4`,
    );
    res.end();
    return;
  }

  // send handles Range, 206/416, Content-Length and Accept-Ranges. dotfiles:
  // the path comes from StorageService (sanitized), but STORAGE_PATH itself may
  // sit under a dot-directory. cacheControl: false so send never adds its own;
  // the caller's opts.cacheControl, if any, was set above.
  res.sendFile(
    path.resolve(video.filePath),
    { dotfiles: 'allow', cacheControl: false },
    (err?: Error & { status?: number; headers?: Record<string, string> }) => {
      // Aborted downloads land here with headers already sent: nothing to do.
      if (!err || res.headersSent) return;
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Disposition');
      res.removeHeader('Cache-Control');
      res
        .status(err.status ?? 500)
        .set(err.headers ?? {})
        .end();
    },
  );
}
