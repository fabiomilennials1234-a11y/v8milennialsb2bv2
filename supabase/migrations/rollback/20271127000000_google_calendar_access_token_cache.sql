-- Rollback of 20271127000000_google_calendar_access_token_cache.sql.
-- Drops only the cache column. The edge fn tolerates its absence (falls back to
-- refreshing the Google token on every read, the pre-F5c behaviour).
BEGIN;

ALTER TABLE public.google_calendar_tokens DROP COLUMN IF EXISTS access_token_cache;

NOTIFY pgrst, 'reload schema';

COMMIT;
