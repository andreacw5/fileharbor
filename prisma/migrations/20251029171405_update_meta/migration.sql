-- AlterTable
ALTER TABLE "images" ADD COLUMN     "description" TEXT,
ADD COLUMN     "downloads" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "image_share_links" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "readToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "image_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "image_share_links_readToken_key" ON "image_share_links"("readToken");

-- CreateIndex
CREATE INDEX "image_share_links_imageId_idx" ON "image_share_links"("imageId");

-- CreateIndex
CREATE INDEX "image_share_links_readToken_idx" ON "image_share_links"("readToken");

-- AddForeignKey
ALTER TABLE "image_share_links" ADD CONSTRAINT "image_share_links_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
