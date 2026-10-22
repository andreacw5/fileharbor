-- Plan 03: perceptual hash for duplicate detection. Nullable: old rows wait for
-- src/scripts/backfill-image-dhash.ts.
ALTER TABLE "images" ADD COLUMN "dHash" CHAR(16);

CREATE INDEX "images_dHash_idx" ON "images"("dHash");
