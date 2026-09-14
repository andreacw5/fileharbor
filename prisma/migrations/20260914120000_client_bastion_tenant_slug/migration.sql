-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "bastionTenantSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clients_bastionTenantSlug_key" ON "clients"("bastionTenantSlug");
