-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "admin_user_bookmarks" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_user_bookmarks_adminUserId_idx" ON "admin_user_bookmarks"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_user_bookmarks_userId_idx" ON "admin_user_bookmarks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_bookmarks_adminUserId_userId_key" ON "admin_user_bookmarks"("adminUserId", "userId");

-- AddForeignKey
ALTER TABLE "admin_user_bookmarks" ADD CONSTRAINT "admin_user_bookmarks_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_bookmarks" ADD CONSTRAINT "admin_user_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
