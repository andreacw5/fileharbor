-- Restores album contents lost by the first version of migration
-- 20260625203420_mixed_albms, which dropped album_images without copying it into
-- album_items. Only needed on a database where that version ran.
--
-- 1. Check whether this database is affected: albums created before the
--    migration that now hold nothing.
--
--      SELECT a.id, a.title, a."createdAt"
--      FROM albums a
--      WHERE a."createdAt" < (SELECT finished_at FROM _prisma_migrations
--                             WHERE migration_name = '20260625203420_mixed_albms')
--        AND NOT EXISTS (SELECT 1 FROM album_items i WHERE i."albumId" = a.id);
--
-- 2. Load album_images from a backup taken before the migration into a table
--    named album_images_backup, e.g.:
--
--      psql "$DATABASE_URL" -c 'CREATE TABLE album_images_backup ("id" text, "albumId" text, "imageId" text, "order" int, "createdAt" timestamp(3))'
--      pg_restore --data-only -t album_images -f - <backup> \
--        | sed 's/public\.album_images /public.album_images_backup /' \
--        | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
--
-- 3. Run this file:
--
--      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/recover-album-items.sql
--
-- Safe to re-run: rows already present (same album and image) are skipped, and so
-- are rows whose album or image has since been deleted. A restored item can share
-- an order value with one added after the migration; that only affects their
-- relative position.

BEGIN;

INSERT INTO "album_items" ("id", "albumId", "imageId", "resourceType", "order", "addedAt")
SELECT gen_random_uuid()::text, b."albumId", b."imageId", 'IMAGE', b."order", b."createdAt"
FROM "album_images_backup" b
JOIN "albums" a ON a."id" = b."albumId"
JOIN "images" i ON i."id" = b."imageId"
ON CONFLICT ("albumId", "imageId") DO NOTHING;

COMMIT;

-- Then: DROP TABLE album_images_backup;
