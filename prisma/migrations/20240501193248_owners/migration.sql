/*
  Warnings:

  - Added the required column `ownerId` to the `localFiles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "localFiles" ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER;

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "externalId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_externalId_domain_key" ON "owners"("externalId", "domain");

-- AddForeignKey
ALTER TABLE "localFiles" ADD CONSTRAINT "localFiles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
