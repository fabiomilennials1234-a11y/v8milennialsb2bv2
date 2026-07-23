-- Schedule whatsapp-health-monitor edge function every 5 minutes.
--
-- Compares v8 inbound count vs Uazapi /message/find for each connected Uazapi
-- instance. Severe drift triggers an auto-rebind. Snapshots persist in
-- whatsapp_health_checks for the operator dashboard.

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_health_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[whatsapp-health-monitor] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-health-monitor');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-health-monitor] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_health_monitor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_health_monitor() TO service_role;

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping whatsapp_health_monitor schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_health_monitor') THEN
    PERFORM cron.unschedule('whatsapp_health_monitor');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_health_monitor',
    '*/5 * * * *',
    'SELECT public.invoke_whatsapp_health_monitor()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_whatsapp_health_monitor() IS
  'Invokes whatsapp-health-monitor every 5 minutes via pg_net. Drift detection '
  'and auto-rebind for Uazapi instances.';
