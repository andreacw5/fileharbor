-- Admin identity moves to Bastion: `admin_users` stops being a mirror of Bastion's
-- users and is replaced by `admin_principals`, a table of exceptions only.
--
-- Two problems are solved here at once:
--   1. Client scope no longer needs a per-admin client list — a plain admin sees
--      the clients of the tenant in their token.
--   2. A Bastion `sub` is per tenant, so the same person has several. Identities
--      map those subs onto one principal, which is what makes personal clients
--      visible from whichever tenant that person signs in through.
--
-- This migration only ADDS and backfills. The old tables are dropped by the next
-- migration, so a rollback in between loses nothing.

-- CreateTable
CREATE TABLE "admin_principals" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fullAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_principals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_identities" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "bastionUserId" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_identities_bastionUserId_key" ON "admin_identities"("bastionUserId");
CREATE UNIQUE INDEX "admin_identities_principalId_tenantSlug_key" ON "admin_identities"("principalId", "tenantSlug");
CREATE INDEX "admin_identities_principalId_idx" ON "admin_identities"("principalId");

-- AddForeignKey
ALTER TABLE "admin_identities" ADD CONSTRAINT "admin_identities_principalId_fkey"
    FOREIGN KEY ("principalId") REFERENCES "admin_principals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: personal clients. Mutually exclusive with bastionTenantSlug —
-- a client belongs to a tenant or to a person, never to both.
ALTER TABLE "clients" ADD COLUMN "ownerPrincipalId" TEXT;

CREATE INDEX "clients_ownerPrincipalId_idx" ON "clients"("ownerPrincipalId");

ALTER TABLE "clients" ADD CONSTRAINT "clients_ownerPrincipalId_fkey"
    FOREIGN KEY ("ownerPrincipalId") REFERENCES "admin_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_xor_tenant"
    CHECK ("ownerPrincipalId" IS NULL OR "bastionTenantSlug" IS NULL);

-- Backfill: every admin who had access to all clients becomes a principal with
-- fullAccess, keeping today's reach. Admins scoped through admin_client_access
-- get no row: their access is now their tenant's. Verify that list before
-- deploying — see the SELECT in the project docs.
-- The principal id is derived from the Bastion sub so the identity insert below
-- can recompute it without joining on a label, which is not unique.
INSERT INTO "admin_principals" ("id", "label", "fullAccess", "createdAt", "updatedAt")
SELECT md5("bastionUserId")::uuid::text, COALESCE("username", "email"), true, "createdAt", NOW()
FROM "admin_users"
WHERE "allClientsAccess" = true AND "active" = true;

-- One identity per backfilled admin. tenantSlug is unknown here (the old table
-- never stored it) and is documentation only, so it is marked as such.
INSERT INTO "admin_identities" ("id", "principalId", "bastionUserId", "tenantSlug", "createdAt")
SELECT gen_random_uuid()::text, md5("bastionUserId")::uuid::text, "bastionUserId", 'unknown-backfill', NOW()
FROM "admin_users"
WHERE "allClientsAccess" = true AND "active" = true;

-- Bookmarks are re-keyed onto an actor: the principal id when the admin was
-- backfilled into one, otherwise `sub:<bastionUserId>` so nothing is orphaned.
ALTER TABLE "admin_image_bookmarks" ADD COLUMN "actorId" TEXT;
ALTER TABLE "admin_user_bookmarks" ADD COLUMN "actorId" TEXT;
ALTER TABLE "admin_video_bookmarks" ADD COLUMN "actorId" TEXT;

UPDATE "admin_image_bookmarks" b
SET "actorId" = COALESCE(i."principalId", 'sub:' || u."bastionUserId")
FROM "admin_users" u
LEFT JOIN "admin_identities" i ON i."bastionUserId" = u."bastionUserId"
WHERE b."adminUserId" = u."id";

UPDATE "admin_user_bookmarks" b
SET "actorId" = COALESCE(i."principalId", 'sub:' || u."bastionUserId")
FROM "admin_users" u
LEFT JOIN "admin_identities" i ON i."bastionUserId" = u."bastionUserId"
WHERE b."adminUserId" = u."id";

UPDATE "admin_video_bookmarks" b
SET "actorId" = COALESCE(i."principalId", 'sub:' || u."bastionUserId")
FROM "admin_users" u
LEFT JOIN "admin_identities" i ON i."bastionUserId" = u."bastionUserId"
WHERE b."adminUserId" = u."id";

-- Any row whose admin_users row is already gone has nothing to attribute to.
DELETE FROM "admin_image_bookmarks" WHERE "actorId" IS NULL;
DELETE FROM "admin_user_bookmarks" WHERE "actorId" IS NULL;
DELETE FROM "admin_video_bookmarks" WHERE "actorId" IS NULL;

ALTER TABLE "admin_image_bookmarks" ALTER COLUMN "actorId" SET NOT NULL;
ALTER TABLE "admin_user_bookmarks" ALTER COLUMN "actorId" SET NOT NULL;
ALTER TABLE "admin_video_bookmarks" ALTER COLUMN "actorId" SET NOT NULL;

-- Swap the old adminUserId keys for the new actor keys.
DROP INDEX IF EXISTS "admin_image_bookmarks_adminUserId_imageId_key";
DROP INDEX IF EXISTS "admin_image_bookmarks_adminUserId_idx";
DROP INDEX IF EXISTS "admin_user_bookmarks_adminUserId_userId_key";
DROP INDEX IF EXISTS "admin_user_bookmarks_adminUserId_idx";
DROP INDEX IF EXISTS "admin_video_bookmarks_adminUserId_videoId_key";
DROP INDEX IF EXISTS "admin_video_bookmarks_adminUserId_idx";

ALTER TABLE "admin_image_bookmarks" DROP CONSTRAINT IF EXISTS "admin_image_bookmarks_adminUserId_fkey";
ALTER TABLE "admin_user_bookmarks" DROP CONSTRAINT IF EXISTS "admin_user_bookmarks_adminUserId_fkey";
ALTER TABLE "admin_video_bookmarks" DROP CONSTRAINT IF EXISTS "admin_video_bookmarks_adminUserId_fkey";

ALTER TABLE "admin_image_bookmarks" DROP COLUMN "adminUserId";
ALTER TABLE "admin_user_bookmarks" DROP COLUMN "adminUserId";
ALTER TABLE "admin_video_bookmarks" DROP COLUMN "adminUserId";

CREATE UNIQUE INDEX "admin_image_bookmarks_actorId_imageId_key" ON "admin_image_bookmarks"("actorId", "imageId");
CREATE INDEX "admin_image_bookmarks_actorId_idx" ON "admin_image_bookmarks"("actorId");
CREATE UNIQUE INDEX "admin_user_bookmarks_actorId_userId_key" ON "admin_user_bookmarks"("actorId", "userId");
CREATE INDEX "admin_user_bookmarks_actorId_idx" ON "admin_user_bookmarks"("actorId");
CREATE UNIQUE INDEX "admin_video_bookmarks_actorId_videoId_key" ON "admin_video_bookmarks"("actorId", "videoId");
CREATE INDEX "admin_video_bookmarks_actorId_idx" ON "admin_video_bookmarks"("actorId");
