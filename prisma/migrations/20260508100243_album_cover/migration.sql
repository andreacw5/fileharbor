-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "coverImageId" TEXT;

-- CreateIndex
CREATE INDEX "albums_coverImageId_idx" ON "albums"("coverImageId");

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
