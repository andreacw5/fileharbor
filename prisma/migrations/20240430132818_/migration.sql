-- AlterTable
ALTER TABLE "localFiles" ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'local';
