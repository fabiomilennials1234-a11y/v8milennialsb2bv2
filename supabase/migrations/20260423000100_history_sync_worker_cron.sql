-- Sprint 2 S2.1 — pg_cron trigger history-sync-worker (1min).
--
-- Cron calls the edge function via pg_net with x-cron-secret header.
-- Pattern mirrors process-followup-automations, process-copilot-followups, etc.
--
-- Prereq:
--   - pg_cron + pg_net extensions (already enabled in Supabase managed).
--   - CRON_SECRET set via `supabase secrets set CRON_SECRET=...`.
--   - SUPABASE_URL available in pg_net context (Supabase auto-exposes).
--
-- Rollback:
--   SELECT cron.unschedule('history-sync-worker');

DO $$
DECLARE
  v_supabase_url TEXT := current_setting('app.settings.supabase_url', true);
  v_cron_secret TEXT := current_setting('app.settings.cron_secret', true);
BEGIN
  -- Fallback to env if GUC not set (Supabase managed path)
  IF v_supabase_url IS NULL THEN
    v_supabase_url := 'https://bcfadphgsibjzivtbjvc.supabase.co';
  END IF;

  -- Schedule: every 1 minute
  PERFORM cron.schedule(
    'history-sync-worker',
    '* * * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := %L || '/functions/v1/history-sync-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret', true)
        ),
        body := '{}'::jsonb
      )
      $cmd$,
      v_supabase_url
    )
  );
END $$;

COMMENT ON EXTENSION pg_cron IS 'cron job scheduler — history-sync-worker runs every minute';
