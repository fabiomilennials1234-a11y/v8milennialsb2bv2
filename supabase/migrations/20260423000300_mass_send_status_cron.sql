-- Sprint 6 S6.7 — pg_cron trigger mass-send-status (2min)
-- Polls uazapi_sender_jobs em status queued/running via /sender/list Uazapi
-- e reflete no DB.
--
-- Rollback:
--   SELECT cron.unschedule('mass-send-status-poll');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mass-send-status-poll') THEN
    PERFORM cron.schedule(
      'mass-send-status-poll',
      '*/2 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/mass-send-status',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret', true)
        ),
        body := jsonb_build_object('all_running', true)
      )
      $cmd$
    );
  END IF;
END $$;
