-- Rename name → username, add image on admin_users
ALTER TABLE "admin_users" RENAME COLUMN "name" TO "username";
ALTER TABLE "admin_users" ADD COLUMN "image" TEXT;
