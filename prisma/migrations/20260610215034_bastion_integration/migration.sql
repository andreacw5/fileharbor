/*
  Warnings:

  - You are about to drop the column `passwordHash` on the `admin_users` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `admin_users` table. All the data in the column will be lost.
  - You are about to drop the `admin_refresh_tokens` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[bastionUserId]` on the table `admin_users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `bastionUserId` to the `admin_users` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "admin_refresh_tokens" DROP CONSTRAINT "admin_refresh_tokens_adminUserId_fkey";

-- AlterTable
ALTER TABLE "admin_users" DROP COLUMN "passwordHash",
DROP COLUMN "role",
ADD COLUMN     "bastionUserId" TEXT NOT NULL;

-- DropTable
DROP TABLE "admin_refresh_tokens";

-- DropEnum
DROP TYPE "AdminRole";

-- CreateTable
CREATE TABLE "user_cache" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "image" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_bastionUserId_key" ON "admin_users"("bastionUserId");
