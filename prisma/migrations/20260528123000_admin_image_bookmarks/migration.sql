-- CreateTable
CREATE TABLE "admin_image_bookmarks" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_image_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_image_bookmarks_adminUserId_imageId_key" ON "admin_image_bookmarks"("adminUserId", "imageId");

-- CreateIndex
CREATE INDEX "admin_image_bookmarks_adminUserId_idx" ON "admin_image_bookmarks"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_image_bookmarks_imageId_idx" ON "admin_image_bookmarks"("imageId");

-- AddForeignKey
ALTER TABLE "admin_image_bookmarks" ADD CONSTRAINT "admin_image_bookmarks_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_image_bookmarks" ADD CONSTRAINT "admin_image_bookmarks_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

