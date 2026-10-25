/**
 * Fills `images.dHash` for rows uploaded before plan 03
 * (docs/plans/03-duplicate-detection.md), or emptied by the 64 -> 256 bit
 * migration. New uploads hash themselves.
 *
 * Lives in src/ so `nest build` ships it in dist/ (see backfill-media-size.ts).
 * Dry run by default, `--apply` writes:
 *
 *   docker exec <fileharbor-container> node dist/scripts/backfill-image-dhash.js --apply
 *   pnpm exec ts-node -r tsconfig-paths/register src/scripts/backfill-image-dhash.ts   # local
 *
 * One image at a time (a full decode each, CPU-bound). Resumable: only rows with
 * dHash IS NULL are read, so a second run picks up where the first stopped and
 * redoes nothing. A missing or unreadable original is logged and skipped.
 *
 * `--rehash` reads every row instead, for a `computeDHash` change that leaves
 * old values in place (not resumable: a second run starts over).
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../modules/prisma/prisma.service';
import { StorageService } from '../modules/storage/storage.service';

const PAGE = 200;

async function main(apply: boolean, rehash: boolean) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment (container)
  }
  const prisma = new PrismaService();
  const storage = new StorageService(new ConfigService());
  const t = { checked: 0, hashed: 0, failed: 0 };
  try {
    const clients = await prisma.client.findMany({
      select: { id: true, domain: true },
    });
    const domain = new Map(clients.map((c) => [c.id, c.domain || c.id]));

    // Cursor on id, not a re-query of "still null": skipped and dry-run rows stay null.
    let cursor: string | undefined;
    for (;;) {
      const rows = await prisma.image.findMany({
        where: rehash ? {} : { dHash: null },
        select: { id: true, clientId: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (!rows.length) break;
      for (const row of rows) {
        t.checked++;
        const file = storage.getImageFilePath(
          domain.get(row.clientId) ?? row.clientId,
          row.id,
          'original',
        );
        try {
          const dHash = await storage.computeDHash(
            await storage.readFile(file),
          );
          t.hashed++;
          if (apply) {
            await prisma.image.update({
              where: { id: row.id },
              data: { dHash },
            });
          }
        } catch (err) {
          t.failed++;
          console.warn(
            `${row.id}: ${err instanceof Error ? err.message : err}, skipped`,
          );
        }
      }
      cursor = rows[rows.length - 1].id;
      console.log(`… ${t.checked} checked`);
    }

    console.log(apply ? 'Applied:' : 'Dry run (pass --apply to write):');
    console.table({ image: t });
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.includes('--apply'), process.argv.includes('--rehash')).catch(
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
