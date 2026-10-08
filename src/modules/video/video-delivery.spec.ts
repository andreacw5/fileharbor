import express = require('express');
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sendVideo } from './video-delivery';

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
          { download: false, xAccelRedirect: req.query.x === '1' },
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

  it('hands off to nginx, refusing a traversing storage path', async () => {
    const ok = await fetch(`${base}/original.mp4?x=1`);
    expect(ok.headers.get('x-accel-redirect')).toBe(
      '/internal-videos/c/videos/v/original.mp4',
    );
    expect((await ok.arrayBuffer()).byteLength).toBe(0);

    const bad = await fetch(`${base}/original.mp4?x=1&sp=../etc`);
    expect(bad.status).toBe(403);
  });
});
