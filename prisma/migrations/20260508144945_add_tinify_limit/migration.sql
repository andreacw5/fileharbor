-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "currentTinifyLimit" INTEGER NOT NULL DEFAULT 500;

-- AlterTable
ALTER TABLE "images" ADD COLUMN     "tinifyOptimized" BOOLEAN NOT NULL DEFAULT false;
