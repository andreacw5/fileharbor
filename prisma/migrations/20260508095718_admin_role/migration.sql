-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'ADMIN';

-- CreateIndex
CREATE INDEX "admin_users_email_idx" ON "admin_users"("email");
