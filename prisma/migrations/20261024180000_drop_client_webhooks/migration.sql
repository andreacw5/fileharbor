-- Plan 10: per-client Discord webhooks removed.
ALTER TABLE "clients" DROP COLUMN "webhookEnabled",
DROP COLUMN "webhookUrl";
