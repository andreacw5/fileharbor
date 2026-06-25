/*
  Warnings:

  - You are about to drop the `album_images` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AlbumResourceType" AS ENUM ('IMAGE', 'VIDEO');

-- DropForeignKey
ALTER TABLE "album_images" DROP CONSTRAINT "album_images_albumId_fkey";

-- DropForeignKey
ALTER TABLE "album_images" DROP CONSTRAINT "album_images_imageId_fkey";

-- DropTable
DROP TABLE "album_images";

-- CreateTable
CREATE TABLE "album_items" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "imageId" TEXT,
    "videoId" TEXT,
    "resourceType" "AlbumResourceType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "album_items_albumId_order_idx" ON "album_items"("albumId", "order");

-- CreateIndex
CREATE INDEX "album_items_albumId_resourceType_idx" ON "album_items"("albumId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "album_items_albumId_imageId_key" ON "album_items"("albumId", "imageId");

-- CreateIndex
CREATE UNIQUE INDEX "album_items_albumId_videoId_key" ON "album_items"("albumId", "videoId");

-- AddForeignKey
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
