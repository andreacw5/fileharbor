-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "domain" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isOptimized" BOOLEAN NOT NULL DEFAULT false,
    "optimizedAt" TIMESTAMP(3),
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "views" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatars" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "isOptimized" BOOLEAN NOT NULL DEFAULT false,
    "optimizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_images" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_tokens" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_share_links" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "readToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "image_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_apiKey_key" ON "clients"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "clients_domain_key" ON "clients"("domain");

-- CreateIndex
CREATE INDEX "users_clientId_idx" ON "users"("clientId");

-- CreateIndex
CREATE INDEX "users_externalUserId_idx" ON "users"("externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "users_clientId_externalUserId_key" ON "users"("clientId", "externalUserId");

-- CreateIndex
CREATE INDEX "images_clientId_idx" ON "images"("clientId");

-- CreateIndex
CREATE INDEX "images_userId_idx" ON "images"("userId");

-- CreateIndex
CREATE INDEX "images_isOptimized_idx" ON "images"("isOptimized");

-- CreateIndex
CREATE INDEX "images_isPrivate_idx" ON "images"("isPrivate");

-- CreateIndex
CREATE INDEX "avatars_clientId_idx" ON "avatars"("clientId");

-- CreateIndex
CREATE INDEX "avatars_userId_idx" ON "avatars"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "avatars_clientId_userId_key" ON "avatars"("clientId", "userId");

-- CreateIndex
CREATE INDEX "albums_clientId_idx" ON "albums"("clientId");

-- CreateIndex
CREATE INDEX "albums_userId_idx" ON "albums"("userId");

-- CreateIndex
CREATE INDEX "albums_isPublic_idx" ON "albums"("isPublic");

-- CreateIndex
CREATE INDEX "album_images_albumId_idx" ON "album_images"("albumId");

-- CreateIndex
CREATE INDEX "album_images_imageId_idx" ON "album_images"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "album_images_albumId_imageId_key" ON "album_images"("albumId", "imageId");

-- CreateIndex
CREATE UNIQUE INDEX "album_tokens_token_key" ON "album_tokens"("token");

-- CreateIndex
CREATE INDEX "album_tokens_albumId_idx" ON "album_tokens"("albumId");

-- CreateIndex
CREATE INDEX "album_tokens_token_idx" ON "album_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "image_share_links_readToken_key" ON "image_share_links"("readToken");

-- CreateIndex
CREATE INDEX "image_share_links_imageId_idx" ON "image_share_links"("imageId");

-- CreateIndex
CREATE INDEX "image_share_links_readToken_idx" ON "image_share_links"("readToken");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_images" ADD CONSTRAINT "album_images_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_images" ADD CONSTRAINT "album_images_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_tokens" ADD CONSTRAINT "album_tokens_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_share_links" ADD CONSTRAINT "image_share_links_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
