-- Plan 04: daily per-client storage snapshots (StorageSnapshotJob).
-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'AVATAR');

-- CreateTable
CREATE TABLE "storage_snapshots" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "count" INTEGER NOT NULL,
    "bytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_snapshots_clientId_day_idx" ON "storage_snapshots"("clientId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "storage_snapshots_day_clientId_kind_key" ON "storage_snapshots"("day", "clientId", "kind");

-- AddForeignKey
ALTER TABLE "storage_snapshots" ADD CONSTRAINT "storage_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

