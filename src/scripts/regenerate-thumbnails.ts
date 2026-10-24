/**
 * One-off: rebuilds every image's thumb.webp from its stored original and drops the
 * cached variants (docs/plans/06-regenerate-renditions.md). Run it after changing
 * THUMBNAIL_SIZE / THUMBNAIL_QUALITY: existing thumbs keep the old size otherwise.
 * Deploy the new env first, the script reads it from the container.
 *
 * Lives in src/ so `nest build` ships it in dist/. Dry run by default (counts rows and
 * missing originals), `--apply` writes, `--client <clientId>` narrows to one client:
 *
 *   docker exec <fileharbor-container> node dist/scripts/regenerate-thumbnails.js --apply [--client <id>]
 *   pnpm exec ts-node -r tsconfig-paths/register src/scripts/regenerate-thumbnails.ts   # local
 *
 * No AppModule: it would start the crons and the metrics server. Safe with the service
 * running (writes are tmp + rename, one render at a time). Idempotent.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../modules/prisma/prisma.service';
import { StorageService } from '../modules/storage/storage.service';

const PAGE = 500;

async function main(apply: boolean, clientId?: string) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment (container)
  }
  const config = new ConfigService();
  const prisma = new PrismaService();
  const storage = new StorageService(config);
  // Same parsing and defaults as ImageService
  const size = parseInt(config.get('THUMBNAIL_SIZE') || '800');
  const quality = parseInt(config.get('THUMBNAIL_QUALITY') || '70');
  const t = { checked: 0, regenerated: 0, missing: 0, failed: 0 };
  try {
    let cursor: string | undefined;
    for (;;) {
      const rows = await prisma.image.findMany({
        where: clientId ? { clientId } : {},
        select: {
          id: true,
          clientId: true,
          client: { select: { domain: true } },
        },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });
      if (!rows.length) break;
      for (const row of rows) {
        t.checked++;
        const domain = row.client.domain || row.clientId;
        if (
          !(await storage.fileExists(
            storage.getImageFilePath(domain, row.id, 'original'),
          ))
        ) {
          t.missing++;
          console.warn(`${row.id}: original missing, skipped`);
          continue;
        }
        if (!apply) continue;
        try {
          await storage.regenerateImageThumb(domain, row.id, size, quality);
          // Last, like ImageService.regenerateRenditions: updatedAt is in the ETag
          await prisma.image.update({
            where: { id: row.id },
            data: { updatedAt: new Date() },
          });
          t.regenerated++;
        } catch (err) {
          t.failed++;
          console.warn(
            `${row.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      cursor = rows[rows.length - 1].id;
    }
    console.log(
      apply
        ? `Applied (${size}px, q${quality}):`
        : 'Dry run (pass --apply to write):',
    );
    console.table({ image: t });
  } finally {
    await prisma.$disconnect();
  }
}

const args = process.argv.slice(2);
const clientFlag = args.indexOf('--client');
const clientId = clientFlag >= 0 ? args[clientFlag + 1] : undefined;
if (clientFlag >= 0 && !clientId) {
  console.error('--client needs a client id');
  process.exit(1);
}
main(args.includes('--apply'), clientId).catch((err) => {
  console.error(err);
  process.exit(1);
});
