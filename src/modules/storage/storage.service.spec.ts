import {
  BadRequestException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { deflateSync } from 'zlib';
import { StorageService } from './storage.service';

// A PNG whose IHDR claims width x height but carries a single tiny IDAT:
// the header is all metadata() reads, so this is what a decompression bomb
// looks like at validation time.
function pngHeader(width: number, height: number): Buffer {
  const crc32 = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(1))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('StorageService.getImageMetadata', () => {
  const storage = new StorageService({
    get: () => undefined,
  } as unknown as ConfigService);

  it('accepts a real PNG', async () => {
    const png = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();

    await expect(storage.getImageMetadata(png)).resolves.toMatchObject({
      width: 4,
      height: 3,
      format: 'png',
    });
  });

  it('rejects an SVG sent with an image/* MIME type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    await expect(storage.getImageMetadata(svg)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects bytes that are not an image', async () => {
    await expect(
      storage.getImageMetadata(Buffer.from('not an image')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects dimensions over the pixel cap', async () => {
    await expect(
      storage.getImageMetadata(pngHeader(20000, 20000)),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('StorageService animated images', () => {
  const storage = new StorageService({
    get: () => undefined,
  } as unknown as ConfigService);

  // 2-frame 40x30 GIF
  const animatedGif = async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 40, height: 30, channels: 4, background } })
        .png()
        .toBuffer();
    const frames = await Promise.all([frame('#f00'), frame('#0f0')]);
    return sharp(frames, { join: { animated: true } })
      .gif({ delay: [100, 100] })
      .toBuffer();
  };
  const describeOutput = (buf: Buffer) =>
    sharp(buf, { animated: true }).metadata();

  it('reports one frame as the height', async () => {
    await expect(
      storage.getImageMetadata(await animatedGif()),
    ).resolves.toMatchObject({ width: 40, height: 30, format: 'gif' });
  });

  it('keeps every frame in the WebP original and thumbnail', async () => {
    const { original, thumb } = await storage.encodeWebpWithThumbnail(
      await animatedGif(),
      90,
      20,
      80,
    );

    await expect(describeOutput(original)).resolves.toMatchObject({
      format: 'webp',
      pages: 2,
      width: 40,
      pageHeight: 30,
    });
    await expect(describeOutput(thumb)).resolves.toMatchObject({
      pages: 2,
      width: 20,
      pageHeight: 15,
    });
    expect(await storage.isAnimated(original)).toBe(true);
  });

  it('stays animated through optimize and a WebP variant', async () => {
    const { original } = await storage.encodeWebpWithThumbnail(
      await animatedGif(),
      90,
      20,
      80,
    );

    const optimized = await storage.optimizeImage(original, 85);
    expect((await describeOutput(optimized)).pages).toBe(2);

    const variant = await storage.resizeImage(optimized, 16);
    expect(await describeOutput(variant)).toMatchObject({
      pages: 2,
      width: 16,
    });
  });

  it('renders JPEG/PNG from the first frame only', async () => {
    const png = await storage.resizeImage(
      await animatedGif(),
      undefined,
      undefined,
      'png',
    );
    await expect(sharp(png).metadata()).resolves.toMatchObject({
      width: 40,
      height: 30,
    });
  });

  it('does not flag a still image as animated', async () => {
    const jpeg = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    expect(await storage.isAnimated(jpeg)).toBe(false);
  });
});

describe('StorageService JPEG decoder warnings', () => {
  const storage = new StorageService({
    get: () => undefined,
  } as unknown as ConfigService);

  it('encodes a JPEG libjpeg only warns about', async () => {
    // Progressive scans under a baseline SOF0 marker: libjpeg warns
    // "Invalid SOS parameters for sequential JPEG" but still decodes it.
    const jpeg = Buffer.from(
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#c33' },
      })
        .jpeg({ progressive: true })
        .toBuffer(),
    );
    jpeg[jpeg.indexOf(Buffer.from([0xff, 0xc2])) + 1] = 0xc0;

    const { original } = await storage.encodeWebpWithThumbnail(
      jpeg,
      90,
      20,
      80,
    );
    await expect(sharp(original).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 64,
    });
  });
});

describe('StorageService.validatePath', () => {
  const storage = new StorageService({
    get: () => '/srv/storage',
  } as unknown as ConfigService) as any;

  it('accepts paths inside the storage root', () => {
    expect(() =>
      storage.validatePath('/srv/storage/example.com/images/x'),
    ).not.toThrow();
  });

  it.each(['/srv/storage-evil/x', '/srv/storage/../etc/passwd', '/etc'])(
    'rejects %s',
    (target) => expect(() => storage.validatePath(target)).toThrow(),
  );
});

describe('StorageService.computeDHash', () => {
  const storage = new StorageService({
    get: () => undefined,
  } as unknown as ConfigService);

  // 9x8 blocks of 8 px, neighbours at least 30 levels apart: resizing to 9x8
  // lands one block per pixel, so no bit sits on a near-tie.
  const blocks = (seed: number) => {
    const levels: number[] = [];
    for (let i = 0, v = seed; i < 72; i++) {
      v = (v * 1103515245 + 12345) % 2 ** 31;
      let level = v % 256;
      if (i % 9 && Math.abs(level - levels[i - 1]) < 30) {
        level = (levels[i - 1] + 128) % 256;
      }
      levels.push(level);
    }
    const raw = Buffer.alloc(72 * 64 * 3);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 72; x++) {
        raw.fill(
          levels[(y >> 3) * 9 + (x >> 3)],
          (y * 72 + x) * 3,
          (y * 72 + x + 1) * 3,
        );
      }
    }
    return sharp(raw, { raw: { width: 72, height: 64, channels: 3 } });
  };

  it('matches the same picture across quality and size', async () => {
    const q100 = await blocks(1).webp({ quality: 100 }).toBuffer();
    const q85 = await storage.optimizeImage(q100, 85);
    const smaller = await blocks(1)
      .resize(36, 32)
      .webp({ quality: 85 })
      .toBuffer();

    const hash = await storage.computeDHash(q100);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    await expect(storage.computeDHash(q85)).resolves.toBe(hash);
    await expect(storage.computeDHash(smaller)).resolves.toBe(hash);
  });

  it('tells different pictures apart', async () => {
    const a = await blocks(1).png().toBuffer();
    const b = await blocks(2).png().toBuffer();
    expect(await storage.computeDHash(a)).not.toBe(
      await storage.computeDHash(b),
    );
  });

  it('hashes a flat image, transparent or not, to zero', async () => {
    const flat = (background: string) =>
      sharp({ create: { width: 20, height: 20, channels: 4, background } })
        .png()
        .toBuffer();
    for (const bg of ['#3a7', '#00000000']) {
      await expect(storage.computeDHash(await flat(bg))).resolves.toBe(
        '0000000000000000',
      );
    }
  });
});

describe('StorageService.regenerateImageThumb', () => {
  let root: string;
  let storage: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fh-regen-'));
    storage = new StorageService({
      get: (key: string) => (key === 'STORAGE_PATH' ? root : undefined),
    } as unknown as ConfigService);
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('rewrites the thumb at the new size, drops variants, keeps the original', async () => {
    const original = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#c33' },
    })
      .webp()
      .toBuffer();
    const originalPath = storage.getImageFilePath('d', 'img', 'original');
    const variants = storage.getImageVariantsPath('d', 'img');
    await mkdir(variants, { recursive: true });
    await writeFile(originalPath, original);
    await writeFile(join(variants, '64x-q75.webp'), 'stale');
    await writeFile(storage.getImageFilePath('d', 'img', 'thumb'), 'corrupt');

    await storage.regenerateImageThumb('d', 'img', 100, 70);

    const thumb = await sharp(
      await readFile(storage.getImageFilePath('d', 'img', 'thumb')),
    ).metadata();
    expect([thumb.width, thumb.height]).toEqual([100, 50]);
    await expect(stat(variants)).rejects.toThrow();
    expect((await readFile(originalPath)).equals(original)).toBe(true);
  });

  const seed = async () => {
    const original = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#3c3' },
    })
      .webp()
      .toBuffer();
    await mkdir(storage.getImagePath('d', 'img'), { recursive: true });
    await writeFile(storage.getImageFilePath('d', 'img', 'original'), original);
  };

  it('422s on an original that is not an image, writing nothing', async () => {
    await mkdir(storage.getImagePath('d', 'img'), { recursive: true });
    await writeFile(storage.getImageFilePath('d', 'img', 'original'), 'junk');
    await expect(
      storage.regenerateImageThumb('d', 'img', 100, 70),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      stat(storage.getImageFilePath('d', 'img', 'thumb')),
    ).rejects.toThrow();
  });

  it('keeps a thumb write failure a 500', async () => {
    await seed();
    jest
      .spyOn(storage, 'saveFile')
      .mockRejectedValueOnce(new InternalServerErrorException('ENOSPC'));
    await expect(
      storage.regenerateImageThumb('d', 'img', 100, 70),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('only warns when the variants cannot be cleared', async () => {
    await seed();
    jest
      .spyOn(storage, 'clearImageVariants')
      .mockRejectedValueOnce(new InternalServerErrorException('EBUSY'));
    await expect(
      storage.regenerateImageThumb('d', 'img', 100, 70),
    ).resolves.toBeUndefined();
    await expect(
      stat(storage.getImageFilePath('d', 'img', 'thumb')),
    ).resolves.toBeDefined();
  });
});
