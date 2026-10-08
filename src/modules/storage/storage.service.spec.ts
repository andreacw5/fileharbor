import { BadRequestException } from '@nestjs/common';
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
