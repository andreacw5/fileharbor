-- Drops what Bastion now owns.
--
-- Run only once the previous migration's backfill has been checked: after this
-- point the old rows are gone and access comes from `admin_principals` plus the
-- tenant in the token.
--
-- `user_cache` goes too: it was written on every admin request and read by
-- nothing — Bastion's own claims carry the same profile data.

DROP TABLE IF EXISTS "admin_client_access";
DROP TABLE IF EXISTS "admin_users";
DROP TABLE IF EXISTS "user_cache";
