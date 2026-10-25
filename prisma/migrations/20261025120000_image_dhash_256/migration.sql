-- dHash 64 -> 256 bit: icons sharing a frame collided at 8x8. Old values are
-- not comparable with new ones, so they are dropped; refill with
-- src/scripts/backfill-image-dhash.ts --apply.
UPDATE "images" SET "dHash" = NULL;
ALTER TABLE "images" ALTER COLUMN "dHash" TYPE CHAR(64);
