-- Failed optimization runs per image/avatar. The hourly optimize jobs skip rows
-- that reached MAX_OPTIMIZE_ATTEMPTS, so a file that can never be optimized
-- (missing original, corrupt, sharp error) stops occupying the batch forever.
-- Reset to 0 to retry a row.

-- AlterTable
ALTER TABLE "images" ADD COLUMN "optimizeAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "avatars" ADD COLUMN "optimizeAttempts" INTEGER NOT NULL DEFAULT 0;
