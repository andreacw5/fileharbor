-- DropIndex
DROP INDEX "admin_creator_bookmarks_actorId_idx";

-- DropIndex
DROP INDEX "admin_identities_principalId_idx";

-- DropIndex
DROP INDEX "admin_image_bookmarks_actorId_idx";

-- DropIndex
DROP INDEX "admin_video_bookmarks_actorId_idx";

-- DropIndex
DROP INDEX "album_tokens_token_idx";

-- DropIndex
DROP INDEX "albums_clientId_idx";

-- DropIndex
DROP INDEX "albums_isPublic_idx";

-- DropIndex
DROP INDEX "avatars_clientId_idx";

-- DropIndex
DROP INDEX "creators_clientId_idx";

-- DropIndex
DROP INDEX "image_share_links_readToken_idx";

-- DropIndex
DROP INDEX "images_clientId_idx";

-- DropIndex
DROP INDEX "images_isOptimized_idx";

-- DropIndex
DROP INDEX "images_isPrivate_idx";

-- DropIndex
DROP INDEX "tags_clientId_idx";

-- DropIndex
DROP INDEX "videos_clientId_idx";

-- DropIndex
DROP INDEX "videos_isPrivate_idx";

-- CreateIndex
CREATE INDEX "albums_clientId_createdAt_idx" ON "albums"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "avatars_clientId_createdAt_idx" ON "avatars"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "avatars_isOptimized_updatedAt_idx" ON "avatars"("isOptimized", "updatedAt");

-- CreateIndex
CREATE INDEX "creators_clientId_createdAt_idx" ON "creators"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "images_clientId_createdAt_idx" ON "images"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "images_isOptimized_createdAt_idx" ON "images"("isOptimized", "createdAt");

-- CreateIndex
CREATE INDEX "videos_clientId_createdAt_idx" ON "videos"("clientId", "createdAt");
