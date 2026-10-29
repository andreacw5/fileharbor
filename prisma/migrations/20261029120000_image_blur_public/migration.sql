-- Plan 11 addendum: the ?blur=1 rendition of a private image served to anyone.
ALTER TABLE "images" ADD COLUMN "blurPublic" BOOLEAN NOT NULL DEFAULT false;
