-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_tags" (
    "imageId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_tags_pkey" PRIMARY KEY ("imageId", "tagId")
);

-- CreateIndex
CREATE INDEX "tags_clientId_idx" ON "tags"("clientId");

-- CreateIndex
CREATE INDEX "tags_name_idx" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_clientId_name_key" ON "tags"("clientId", "name");

-- CreateIndex
CREATE INDEX "image_tags_tagId_idx" ON "image_tags"("tagId");

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill distinct tags from inline image tag arrays
INSERT INTO "tags" ("id", "clientId", "name", "createdAt", "updatedAt")
SELECT DISTINCT
    md5(i."clientId" || ':' || btrim(tag_name)) AS "id",
    i."clientId",
    btrim(tag_name) AS "name",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "images" i
CROSS JOIN LATERAL unnest(COALESCE(i."tags", ARRAY[]::TEXT[])) AS tag_name
WHERE btrim(tag_name) <> ''
ON CONFLICT ("clientId", "name") DO NOTHING;

-- Backfill image-to-tag links
INSERT INTO "image_tags" ("imageId", "tagId", "createdAt")
SELECT DISTINCT
    i."id" AS "imageId",
    t."id" AS "tagId",
    CURRENT_TIMESTAMP
FROM "images" i
CROSS JOIN LATERAL unnest(COALESCE(i."tags", ARRAY[]::TEXT[])) AS tag_name
INNER JOIN "tags" t
    ON t."clientId" = i."clientId"
   AND t."name" = btrim(tag_name)
WHERE btrim(tag_name) <> ''
ON CONFLICT ("imageId", "tagId") DO NOTHING;

-- Drop the legacy inline tag array after successful backfill
ALTER TABLE "images" DROP COLUMN "tags";

