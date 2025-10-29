-- AlterTable
ALTER TABLE "clients" ADD COLUMN "domain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clients_domain_key" ON "clients"("domain");
