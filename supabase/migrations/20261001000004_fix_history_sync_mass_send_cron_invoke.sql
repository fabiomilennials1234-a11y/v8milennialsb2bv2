-- =====================================================
-- Fix history-sync-worker and mass-send-status cron jobs
-- =====================================================
--
-- Previous migrations (20260423000100, 20260423000300) used
-- current_setting('app.settings.cron_secret') which returns NULL on prod,
-- and hardcoded the DEV project URL as fallback.
--
-- This migration replaces both with invoke_* wrapper functions that read
-- credentials from public.cron_config (same pattern as all other cron jobs).
-- =====================================================

-- ---------------------------------------------------------------------------
-- 1. invoke_history_sync_worker() — every 1 minute
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoke_history_sync_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[history-sync-worker] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'history-sync-worker');

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[history-sync-worker] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_history_sync_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_history_sync_worker() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. invoke_mass_send_status() — every 2 minutes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoke_mass_send_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[mass-send-status] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'mass-send-status');

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('all_running', true),
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[mass-send-status] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_mass_send_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_mass_send_status() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Reschedule cron jobs to use invoke_* functions
-- ---------------------------------------------------------------------------

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cron reschedule';
    RETURN;
  END IF;

  -- history-sync-worker: unschedule old, schedule new
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'history-sync-worker') THEN
    PERFORM cron.unschedule('history-sync-worker');
  END IF;

  PERFORM cron.schedule(
    'history-sync-worker',
    '* * * * *',
    'SELECT public.invoke_history_sync_worker()'
  );

  -- mass-send-status-poll: unschedule old, schedule new
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mass-send-status-poll') THEN
    PERFORM cron.unschedule('mass-send-status-poll');
  END IF;

  PERFORM cron.schedule(
    'mass-send-status-poll',
    '*/2 * * * *',
    'SELECT public.invoke_mass_send_status()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_history_sync_worker() IS
  'Invokes history-sync-worker edge function via pg_net every minute. '
  'Reads URL and secret from cron_config table.';

COMMENT ON FUNCTION public.invoke_mass_send_status() IS
  'Invokes mass-send-status edge function via pg_net every 2 minutes. '
  'Reads URL and secret from cron_config table.';
