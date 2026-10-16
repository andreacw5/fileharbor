-- Videos can exceed 2 GiB (INT4 max): widen size to BIGINT.
ALTER TABLE "videos" ALTER COLUMN "size" SET DATA TYPE BIGINT;
