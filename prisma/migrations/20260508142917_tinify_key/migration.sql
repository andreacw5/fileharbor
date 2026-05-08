-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "currentTinifyUsage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tinifyActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tinifyApiKey" TEXT;
