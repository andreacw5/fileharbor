-- CreateTable
CREATE TABLE "localFiles" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "localFiles_pkey" PRIMARY KEY ("id")
);
