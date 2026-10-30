import express = require('express');
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lastValueFrom, of, throwError } from 'rxjs';
import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { removeVideoTempFile, sendVideo } from './video-delivery';

describe('sendVideo', () => {
  // A dot-directory in the path, as STORAGE_PATH may have.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.fh-video-'));
  const filePath = path.join(dir, 'original.mp4');
  let server: Server;
  let base: string;

  beforeAll((done) => {
    fs.writeFileSync(filePath, Buffer.alloc(1000, 1));
    const app = express();
    app.get('/:name', (req, res) => {
      try {
        sendVideo(
          res,
          {
            storagePath: req.query.sp ? String(req.query.sp) : 'c/videos/v',
            filePath: path.join(dir, req.params.name),
            originalName: 'clip.mp4',
          },
          {
            download: false,
            xAccelRedirect: req.query.x === '1',
            cacheControl: req.query.cc ? String(req.query.cc) : undefined,
          },
        );
      } catch {
        res.status(403).end();
      }
    });
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as any).port}`;
      done();
    });
  });

  afterAll((done) => {
    fs.rmSync(dir, { recursive: true, force: true });
    server.close(done);
  });

  it('serves the whole file, then a byte range', async () => {
    const full = await fetch(`${base}/original.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('content-disposition')).toBe(
      `inline; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
    );
    expect((await full.arrayBuffer()).byteLength).toBe(1000);

    const part = await fetch(`${base}/original.mp4`, {
      headers: { Range: 'bytes=10-19' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect((await part.arrayBuffer()).byteLength).toBe(10);
  });

  it('answers 416 to an unsatisfiable range and 404 to a missing file', async () => {
    const bad = await fetch(`${base}/original.mp4`, {
      headers: { Range: 'bytes=5000-' },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */1000');

    expect((await fetch(`${base}/missing.mp4`)).status).toBe(404);
  });

  const viaNginx = { 'X-Original-URI': '/videos/v/stream' };

  it('hands off to nginx, refusing a traversing storage path', async () => {
    const ok = await fetch(`${base}/original.mp4?x=1`, { headers: viaNginx });
    expect(ok.headers.get('x-accel-redirect')).toBe(
      '/internal-videos/c/videos/v/original.mp4',
    );
    expect((await ok.arrayBuffer()).byteLength).toBe(0);

    const bad = await fetch(`${base}/original.mp4?x=1&sp=../etc`, {
      headers: viaNginx,
    });
    expect(bad.status).toBe(403);
  });

  it('sends the bytes itself when the flag is on but nginx is not in front', async () => {
    const direct = await fetch(`${base}/original.mp4?x=1`);
    expect(direct.status).toBe(200);
    expect(direct.headers.get('x-accel-redirect')).toBeNull();
    expect((await direct.arrayBuffer()).byteLength).toBe(1000);
  });

  it('sends no Cache-Control unless asked, and the given one when asked', async () => {
    const priv = await fetch(`${base}/original.mp4`);
    expect(priv.headers.get('cache-control')).toBeNull();
    await priv.arrayBuffer();

    const pub = await fetch(`${base}/original.mp4?cc=public,%20max-age=86400`);
    expect(pub.headers.get('cache-control')).toBe('public, max-age=86400');
    await pub.arrayBuffer();

    const accel = await fetch(
      `${base}/original.mp4?x=1&cc=public,%20max-age=86400`,
      { headers: viaNginx },
    );
    expect(accel.headers.get('cache-control')).toBe('public, max-age=86400');

    const missing = await fetch(`${base}/missing.mp4?cc=public`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBeNull();
  });
});

describe('removeVideoTempFile', () => {
  const run = (filePath: string, handle: () => any) =>
    lastValueFrom(
      removeVideoTempFile.intercept(
        {
          switchToHttp: () => ({
            getRequest: () => ({ file: { path: filePath } }),
          }),
        } as unknown as ExecutionContext,
        { handle },
      ),
    );
  const tmp = () => {
    const p = path.join(
      os.tmpdir(),
      `fh-upload-${Date.now()}-${Math.random()}.tmp`,
    );
    fs.writeFileSync(p, 'x');
    return p;
  };
  // the unlink is fire-and-forget inside finalize
  const gone = async (p: string) => {
    for (let i = 0; i < 50 && fs.existsSync(p); i++)
      await new Promise((r) => setTimeout(r, 10));
    return !fs.existsSync(p);
  };

  it('removes the temp file when the request is refused before the service', async () => {
    const p = tmp();
    await expect(
      run(p, () => throwError(() => new BadRequestException())),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await gone(p)).toBe(true);
  });

  it('removes it after a successful upload too', async () => {
    const p = tmp();
    await run(p, () => of({ id: 'v' }));
    expect(await gone(p)).toBe(true);
  });
});
