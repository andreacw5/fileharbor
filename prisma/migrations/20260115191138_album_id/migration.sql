/*
  Warnings:

  - A unique constraint covering the columns `[clientId,externalAlbumId]` on the table `albums` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "externalAlbumId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "albums_clientId_externalAlbumId_key" ON "albums"("clientId", "externalAlbumId");
