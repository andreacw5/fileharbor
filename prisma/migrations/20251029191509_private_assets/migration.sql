-- AlterTable
ALTER TABLE "images" ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "images_isPrivate_idx" ON "images"("isPrivate");
