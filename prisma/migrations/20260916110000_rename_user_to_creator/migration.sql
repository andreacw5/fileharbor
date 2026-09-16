-- Rename the content-owner entity from "user" to "creator".
--
-- FileHarbor's `users` table never held logins: a row is the owner of images, videos,
-- avatars and albums, identified by an id belonging to the calling system. Real logins
-- live in Bastion (`admin_principals` / `admin_identities`), so the old name collided
-- with the one concept it is not.
--
-- Everything here is a rename. No row is copied, no id changes, and every foreign key
-- follows its table automatically — an INSERT-based migration would have minted new ids
-- and orphaned five foreign keys.

-- Tables
ALTER TABLE "users" RENAME TO "creators";
ALTER TABLE "admin_user_bookmarks" RENAME TO "admin_creator_bookmarks";

-- Columns
ALTER TABLE "creators" RENAME COLUMN "externalUserId" TO "externalId";
ALTER TABLE "images" RENAME COLUMN "userId" TO "creatorId";
ALTER TABLE "videos" RENAME COLUMN "userId" TO "creatorId";
ALTER TABLE "avatars" RENAME COLUMN "userId" TO "creatorId";
ALTER TABLE "albums" RENAME COLUMN "userId" TO "creatorId";
ALTER TABLE "admin_creator_bookmarks" RENAME COLUMN "userId" TO "creatorId";

-- Constraints (renaming a PK/unique constraint renames its backing index too)
ALTER TABLE "creators" RENAME CONSTRAINT "users_pkey" TO "creators_pkey";
ALTER TABLE "creators" RENAME CONSTRAINT "users_clientId_fkey" TO "creators_clientId_fkey";
ALTER TABLE "images" RENAME CONSTRAINT "images_userId_fkey" TO "images_creatorId_fkey";
ALTER TABLE "videos" RENAME CONSTRAINT "videos_userId_fkey" TO "videos_creatorId_fkey";
ALTER TABLE "avatars" RENAME CONSTRAINT "avatars_userId_fkey" TO "avatars_creatorId_fkey";
ALTER TABLE "albums" RENAME CONSTRAINT "albums_userId_fkey" TO "albums_creatorId_fkey";
ALTER TABLE "admin_creator_bookmarks" RENAME CONSTRAINT "admin_user_bookmarks_pkey" TO "admin_creator_bookmarks_pkey";
ALTER TABLE "admin_creator_bookmarks" RENAME CONSTRAINT "admin_user_bookmarks_userId_fkey" TO "admin_creator_bookmarks_creatorId_fkey";

-- Indexes (names must match what Prisma derives, or the next migrate reports drift)
ALTER INDEX "users_clientId_idx" RENAME TO "creators_clientId_idx";
ALTER INDEX "users_externalUserId_idx" RENAME TO "creators_externalId_idx";
ALTER INDEX "users_clientId_externalUserId_key" RENAME TO "creators_clientId_externalId_key";
ALTER INDEX "images_userId_idx" RENAME TO "images_creatorId_idx";
ALTER INDEX "videos_userId_idx" RENAME TO "videos_creatorId_idx";
ALTER INDEX "videos_clientId_userId_idx" RENAME TO "videos_clientId_creatorId_idx";
ALTER INDEX "avatars_userId_idx" RENAME TO "avatars_creatorId_idx";
ALTER INDEX "avatars_clientId_userId_key" RENAME TO "avatars_clientId_creatorId_key";
ALTER INDEX "albums_userId_idx" RENAME TO "albums_creatorId_idx";
ALTER INDEX "admin_user_bookmarks_actorId_idx" RENAME TO "admin_creator_bookmarks_actorId_idx";
ALTER INDEX "admin_user_bookmarks_userId_idx" RENAME TO "admin_creator_bookmarks_creatorId_idx";
ALTER INDEX "admin_user_bookmarks_actorId_userId_key" RENAME TO "admin_creator_bookmarks_actorId_creatorId_key";
