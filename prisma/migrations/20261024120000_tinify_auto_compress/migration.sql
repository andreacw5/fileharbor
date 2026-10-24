-- Plan 01: automatic Tinify compression. Null threshold = off, so no client changes behaviour.
ALTER TABLE "clients" ADD COLUMN "tinifyAutoMinBytes" INTEGER;

ALTER TABLE "images" ADD COLUMN "tinifyAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "images_clientId_tinifyOptimized_size_idx" ON "images"("clientId", "tinifyOptimized", "size");
