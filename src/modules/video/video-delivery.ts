import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { diskStorage } from 'multer';
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
 * Sends an MP4, with Range support, for the client and admin stream routes.
 *
 * X-Accel-Redirect is opt-in, not inferred from NODE_ENV: it delegates delivery to
 * nginx and sends an empty body, which only works behind an nginx that declares
 * the `/internal-videos/` internal location. Everywhere else the caller gets
 * `video/mp4` with zero bytes and the player reports an unsupported format.
 */
export function sendVideo(
  res: Response,
  video: { storagePath: string; filePath: string; originalName: string },
  opts: { download: boolean; xAccelRedirect: boolean },
): void {
  if (
    opts.xAccelRedirect &&
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
  });

  if (opts.xAccelRedirect) {
    res.set(
      'X-Accel-Redirect',
      `/internal-videos/${video.storagePath}/original.mp4`,
    );
    res.end();
    return;
  }

  // send handles Range, 206/416, Content-Length and Accept-Ranges. dotfiles:
  // the path comes from StorageService (sanitized), but STORAGE_PATH itself may
  // sit under a dot-directory. No Cache-Control: admin streams private videos.
  res.sendFile(
    path.resolve(video.filePath),
    { dotfiles: 'allow', cacheControl: false },
    (err?: Error & { status?: number; headers?: Record<string, string> }) => {
      // Aborted downloads land here with headers already sent: nothing to do.
      if (!err || res.headersSent) return;
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Disposition');
      res
        .status(err.status ?? 500)
        .set(err.headers ?? {})
        .end();
    },
  );
}
