/**
 * One-off: extracts thumb.webp for every video that has none. Images built before
 * 4.0.1 shipped without the ffmpeg-static binary (pnpm 10 skipped its postinstall),
 * so uploads of that period kept original.mp4 and no thumb: the console shows no
 * poster and `GET …/videos/:id/thumb` is a 404.
 *
 * Same shape as regenerate-thumbnails.ts: in src/ so `nest build` ships it in dist/,
 * dry run by default (counts), `--apply` writes, `--client <clientId>` narrows, `--force`
 * redoes thumbs that exist. Videos whose original is missing are reported and skipped.
 *
 *   docker exec <fileharbor-container> node dist/scripts/backfill-video-thumbnails.js --apply [--client <id>]
 *   pnpm exec ts-node -r tsconfig-paths/register src/scripts/backfill-video-thumbnails.ts   # local
 *
 * No AppModule: it would start the crons and the metrics server. Safe with the service
 * running: one ffmpeg at a time, the thumb is written whole. Idempotent.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../modules/prisma/prisma.service';
import { StorageService } from '../modules/storage/storage.service';

const PAGE = 500;

async function main(apply: boolean, force: boolean, clientId?: string) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env: rely on the environment (container)
  }
  const config = new ConfigService();
  const prisma = new PrismaService();
  const storage = new StorageService(config);
  // Same parsing and default as VideoService
  const quality = parseInt(config.get('VIDEO_THUMBNAIL_QUALITY') || '80');
  const t = { checked: 0, present: 0, extracted: 0, missing: 0, failed: 0 };
  try {
    let lastId: string | undefined;
    for (;;) {
      const rows = await prisma.video.findMany({
        where: {
          ...(clientId && { clientId }),
          ...(lastId && { id: { gt: lastId } }),
        },
        select: {
          id: true,
          clientId: true,
          client: { select: { domain: true } },
        },
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      if (!rows.length) {
        if (!lastId && clientId)
          console.warn(`no videos for client ${clientId}`);
        break;
      }
      for (const row of rows) {
        t.checked++;
        const domain = row.client.domain || row.clientId;
        const original = storage.getVideoFilePath(domain, row.id, 'original');
        const thumb = storage.getVideoFilePath(domain, row.id, 'thumb');
        if (!(await storage.fileExists(original))) {
          t.missing++;
          console.warn(`${row.id}: original missing, skipped`);
          continue;
        }
        if (!force && (await storage.fileExists(thumb))) {
          t.present++;
          continue;
        }
        if (!apply) continue;
        try {
          await storage.extractVideoThumbnail(original, thumb, quality);
          t.extracted++;
        } catch (err) {
          t.failed++;
          console.warn(
            `${row.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      lastId = rows[rows.length - 1].id;
    }
    console.log(
      apply ? `Applied (q${quality}):` : 'Dry run (pass --apply to write):',
    );
    console.table({ video: t });
  } finally {
    await prisma.$disconnect();
  }
}

const args = process.argv.slice(2);
// --client <id> or --client=<id>
const clientFlag = args.findIndex(
  (a) => a === '--client' || a.startsWith('--client='),
);
const clientId =
  clientFlag < 0
    ? undefined
    : args[clientFlag].startsWith('--client=')
      ? args[clientFlag].slice('--client='.length)
      : args[clientFlag + 1];
if (clientFlag >= 0 && (!clientId || clientId.startsWith('--'))) {
  console.error('--client needs a client id');
  process.exit(1);
}
main(args.includes('--apply'), args.includes('--force'), clientId).catch(
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
