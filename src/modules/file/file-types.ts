import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * The only accepted downloads. The extension picks the row, the magic bytes must
 * match it, and `mimeType` is what we serve: the browser's mimetype never counts
 * (a zip arrives as application/zip, x-zip-compressed or octet-stream).
 *
 * `PK\x03\x04` also opens docx/xlsx/jar/apk/epub: renamed to .zip they pass and
 * are served as application/zip attachments. Fine, the content is never opened
 * server-side: no zip or PDF parser, no zip bomb. An empty (`PK\x05\x06`) or
 * spanned (`PK\x07\x08`) zip fails the magic check.
 */
export const FILE_TYPES = {
  zip: {
    magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    mimeType: 'application/zip',
  },
  pdf: { magic: Buffer.from('%PDF-', 'ascii'), mimeType: 'application/pdf' },
} as const;

export type FileExt = keyof typeof FILE_TYPES;

/** Bytes to read from the upload for `detectFileType`. */
export const MAGIC_BYTES = 8;

export function extensionOf(filename: string): FileExt | undefined {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, ext)
    ? (ext as FileExt)
    : undefined;
}

/** The type when the name's extension and the leading bytes agree, else undefined. */
export function detectFileType(
  filename: string,
  head: Buffer,
): FileExt | undefined {
  const ext = extensionOf(filename);
  if (!ext) return undefined;
  const { magic } = FILE_TYPES[ext];
  return head.subarray(0, magic.length).equals(magic) ? ext : undefined;
}

export const unsupportedFileType = () =>
  new BadRequestException({
    code: 'UNSUPPORTED_FILE_TYPE',
    message: 'Only .zip and .pdf files are allowed',
  });

/**
 * Multer options for the client and admin upload routes. Rejects by extension
 * only, before writing up to 200 MB to disk; the service checks the magic bytes.
 * The size limit reads process.env at import, before Joi runs: the string
 * fallback here is the real default, the Joi entry only validates.
 */
export const fileMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.file.tmp`),
  }),
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    if (!extensionOf(file.originalname)) {
      return cb(unsupportedFileType(), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: parseInt(process.env.MAX_DOWNLOAD_FILE_SIZE || '209715200'),
  },
};
