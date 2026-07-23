-- =====================================================
-- Schedule cron-health-check edge function every 5 minutes
-- =====================================================
--
-- Calls cron-health-check via pg_net using the same cron_config.cron_secret
-- that other workflow cron jobs use. If that secret is rejected, the
-- health-check edge function logs an error to runtime_logs + emits Sentry,
-- giving us a closed-loop alert before users notice silently broken automations.
-- =====================================================

CREATE OR REPLACE FUNCTION public.invoke_cron_health_check()
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
    RAISE WARNING '[cron-health-check] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'cron-health-check');

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[cron-health-check] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_cron_health_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_cron_health_check() TO service_role;

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cron_health_check schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron_health_check') THEN
    PERFORM cron.unschedule('cron_health_check');
  END IF;

  PERFORM cron.schedule(
    'cron_health_check',
    '*/5 * * * *',
    'SELECT public.invoke_cron_health_check()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_cron_health_check() IS
  'Invokes cron-health-check edge function via pg_net every 5 minutes. '
  'Detects CRON_SECRET drift between cron_config table and edge function env.';
