-- Data migration: album_images → album_items
-- Da aggiungere MANUALMENTE nella migration generata da prisma migrate dev,
-- DOPO il CREATE TABLE "album_items" e PRIMA del DROP TABLE "album_images".

INSERT INTO "album_items" (id, "albumId", "imageId", "resourceType", "order", "addedAt")
SELECT
  gen_random_uuid(),
  "albumId",
  "imageId",
  'IMAGE'::"AlbumResourceType",
  "order",
  "createdAt"
FROM "album_images";
