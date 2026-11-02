import express = require('express');
import helmet from 'helmet';
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { BastionAuditService } from '@heyatom/bastion-client/nest';
import type { PrismaService } from '@/modules/prisma/prisma.service';
import type { StorageService } from '@/modules/storage/storage.service';
import type { CreatorService } from '@/modules/creator/creator.service';
import type { RouteHelperService } from '@/utils/route.utils';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { signFileLink } from './file-link';

const SECRET = 's'.repeat(32);

describe('FileController', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-files-'));
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'pub',
    clientId: 'c1',
    originalName: 'red pack.zip',
    storagePath: 'c1/files/pub',
    mimeType: 'application/zip',
    isPrivate: false,
    client: { domain: null },
    ...over,
  });
  const files: Record<string, ReturnType<typeof row>> = {
    pub: row(),
    priv: row({ id: 'priv', isPrivate: true, storagePath: 'c1/files/priv' }),
  };

  const prisma = {
    client: { findUnique: jest.fn().mockResolvedValue({ domain: null }) },
    storedFile: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          files[where.id] &&
            (!where.clientId || files[where.id].clientId === where.clientId)
            ? files[where.id]
            : null,
        ),
      ),
      create: jest.fn(({ data }) =>
        Promise.resolve({ ...data, creator: { externalId: 'system' } }),
      ),
      update: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const storage = {
    getFilePath: (_d: string, id: string, ext: string) =>
      path.join(dir, `${id}.${ext}`),
    copyFromTemp: jest.fn().mockResolvedValue(undefined),
  };
  const service = new FileService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    {
      resolveCreator: jest.fn().mockResolvedValue({ id: 'k1' }),
    } as unknown as CreatorService,
    {
      fullUrl: (...s: string[]) => `https://cdn.test/${s.join('/')}`,
    } as unknown as RouteHelperService,
    { get: () => SECRET } as unknown as ConfigService,
  );
  const controller = new FileController(service, {
    write: jest.fn().mockResolvedValue(undefined),
  } as unknown as BastionAuditService);

  let server: Server;
  let base: string;

  beforeAll((done) => {
    fs.writeFileSync(path.join(dir, 'pub.zip'), Buffer.alloc(1000, 1));
    fs.writeFileSync(path.join(dir, 'priv.zip'), Buffer.alloc(1000, 2));
    const app = express();
    app.use(helmet());
    // Stands in for ClientInterceptor on a @Public() route: the key is optional.
    app.get('/files/:id/download', (req, res) => {
      const keys: Record<string, string> = { 'key-c1': 'c1', 'key-c2': 'c2' };
      (req as any).clientId = keys[req.header('x-api-key') ?? ''];
      controller
        .download(
          req.params.id,
          req.query.token as string | undefined,
          req.header('range'),
          req,
          res,
        )
        .catch((e) =>
          res.status(e instanceof HttpException ? e.getStatus() : 500).end(),
        );
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

  beforeEach(() => jest.clearAllMocks());

  const get = (id: string, headers: Record<string, string> = {}, query = '') =>
    fetch(`${base}/files/${id}/download${query}`, { headers });
  const settle = () => new Promise((r) => setImmediate(r));

  it('serves a public file without a key, as an immutable attachment, and counts it', async () => {
    const res = await get('pub');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="red pack.zip"/,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
    await settle();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // Raw SQL only: an update() would bump updatedAt
    expect(prisma.storedFile.update).not.toHaveBeenCalled();
  });

  it('serves a Range chunk as 206 without counting it', async () => {
    const res = await get('pub', { Range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    await settle();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('hides a private file without a key, or with another client key, as 404', async () => {
    expect((await get('priv')).status).toBe(404);
    expect((await get('priv', { 'x-api-key': 'key-c2' })).status).toBe(404);
    expect((await get('missing')).status).toBe(404);
  });

  it('serves a private file to its own client, never cached', async () => {
    const res = await get('priv', { 'x-api-key': 'key-c1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    await res.arrayBuffer();
  });

  it('serves a private file with a valid signed token, not with a bad one', async () => {
    const { token } = signFileLink('priv', SECRET);
    const ok = await get('priv', {}, `?token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    await ok.arrayBuffer();

    const other = signFileLink('pub', SECRET).token;
    const expired = signFileLink('priv', SECRET, Date.now() - 3_600_000).token;
    for (const bad of [other, expired, `${token}x`, 'nope']) {
      expect((await get('priv', {}, `?token=${bad}`)).status).toBe(404);
    }
  });

  it('signs a link only for a file of the calling client', async () => {
    const link = await controller.createLink('priv', 'c1');
    expect(link.url).toMatch(
      /^https:\/\/cdn\.test\/files\/priv\/download\?token=\d+\.[\w-]+$/,
    );
    await expect(controller.createLink('priv', 'c2')).rejects.toMatchObject({
      status: 404,
    });
  });

  describe('upload', () => {
    const upload = (name: string, bytes: Buffer) => {
      const p = path.join(dir, `${Math.random()}.tmp`);
      fs.writeFileSync(p, bytes);
      return {
        path: p,
        originalname: name,
        size: bytes.length,
      } as Express.Multer.File;
    };

    it('stores a zip under its canonical type, whatever the browser said', async () => {
      const file = upload(
        'red.zip',
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
      );
      const res = await controller.uploadFile('c1', undefined, file, {});
      expect(res).toMatchObject({
        mimeType: 'application/zip',
        size: 8,
        isPrivate: false,
        creator: { externalId: 'system' },
      });
      expect(res.downloadUrl).toBe(`https://cdn.test/files/${res.id}/download`);
      expect(storage.copyFromTemp).toHaveBeenCalledWith(
        file.path,
        path.join(dir, `${res.id}.zip`),
      );
      expect(fs.existsSync(file.path)).toBe(false);
    });

    it('rejects a pdf renamed .zip with UNSUPPORTED_FILE_TYPE and drops the temp file', async () => {
      const file = upload('red.zip', Buffer.from('%PDF-1.7'));
      await expect(
        controller.uploadFile('c1', undefined, file, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'UNSUPPORTED_FILE_TYPE' },
      });
      expect(prisma.storedFile.create).not.toHaveBeenCalled();
      expect(fs.existsSync(file.path)).toBe(false);
    });
  });
});
