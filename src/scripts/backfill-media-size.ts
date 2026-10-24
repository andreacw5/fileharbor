/**
 * One-off: realigns `size` of already-optimized images and avatars with the file on
 * disk. Until plan 01 step 1 (docs/plans/01-tinify-auto-compress.md) the optimize jobs
 * re-encoded the original but kept the upload-time size. Run it after deploying that
 * fix, or rows optimized in between come back wrong.
 *
 * Lives in src/ so `nest build` ships it in dist/: the prod image has no ts-node and no
 * scripts/ folder. Dry run by default, `--apply` writes:
 *
 *   docker exec <fileharbor-container> node dist/scripts/backfill-media-size.js --apply
 *   pnpm exec ts-node -r tsconfig-paths/register src/scripts/backfill-media-size.ts   # local
 *
 * No AppModule: it would start the crons and the metrics server. Idempotent.
 */
import { stat } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../modules/prisma/prisma.service';
import { StorageService } from '../modules/storage/storage.service';

const PAGE = 500;

type Row = { id: string; clientId: string; size: number };
type Totals = {
  checked: number;
  changed: number;
  missing: number;
  before: number;
  after: number;
};

async function backfill(
  kind: string,
  page: (cursor?: string) => Promise<Row[]>,
  filePath: (row: Row) => string,
  update: (id: string, size: number) => Promise<unknown>,
  apply: boolean,
): Promise<Totals> {
  const t: Totals = { checked: 0, changed: 0, missing: 0, before: 0, after: 0 };
  let cursor: string | undefined;
  for (let rows = await page(); rows.length; rows = await page(cursor)) {
    for (const row of rows) {
      t.checked++;
      const size = await stat(filePath(row)).then(
        (s) => s.size,
        () => null,
      );
      if (size === null) {
        t.missing++;
        console.warn(`[${kind}] ${row.id}: original missing, skipped`);
        continue;
      }
      if (size === row.size) continue;
      t.changed++;
      t.before += row.size;
      t.after += size;
      if (apply) await update(row.id, size);
    }
    cursor = rows[rows.length - 1].id;
  }
  return t;
}

async function main(apply: boolean) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment (container)
  }
  const prisma = new PrismaService();
  const storage = new StorageService(new ConfigService());
  try {
    const clients = await prisma.client.findMany({
      select: { id: true, domain: true },
    });
    const domain = new Map(clients.map((c) => [c.id, c.domain || c.id]));
    const dir = (row: Row) => domain.get(row.clientId) ?? row.clientId;
    const select = { id: true, clientId: true, size: true } as const;
    const pageArgs = (cursor?: string) => ({
      where: { isOptimized: true },
      select,
      orderBy: { id: 'asc' as const },
      take: PAGE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const images = await backfill(
      'image',
      (cursor) => prisma.image.findMany(pageArgs(cursor)),
      (row) => storage.getImageFilePath(dir(row), row.id, 'original'),
      (id, size) => prisma.image.update({ where: { id }, data: { size } }),
      apply,
    );
    const avatars = await backfill(
      'avatar',
      (cursor) =>
        prisma.avatar.findMany({
          ...pageArgs(cursor),
          select: { ...select, creatorId: true },
        }),
      (row) =>
        storage.getAvatarFilePath(
          dir(row),
          (row as Row & { creatorId: string }).creatorId,
          'original',
        ),
      (id, size) => prisma.avatar.update({ where: { id }, data: { size } }),
      apply,
    );

    console.log(apply ? 'Applied:' : 'Dry run (pass --apply to write):');
    console.table({ image: images, avatar: avatars });
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.includes('--apply')).catch((err) => {
  console.error(err);
  process.exit(1);
});
