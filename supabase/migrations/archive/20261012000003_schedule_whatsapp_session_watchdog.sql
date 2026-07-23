-- Schedule whatsapp-session-watchdog edge function every 10 minutes.
--
-- Detects WhatsApp sessions that died on the Uazapi side (logged out from
-- another device, QR timeout, etc.) and stamps session_dead_since on the
-- whatsapp_instances row so the UI / notification subsystem can react.

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_session_watchdog()
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
    RAISE WARNING '[whatsapp-session-watchdog] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-session-watchdog');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-session-watchdog] invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_session_watchdog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_session_watchdog() TO service_role;

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping whatsapp_session_watchdog schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_session_watchdog') THEN
    PERFORM cron.unschedule('whatsapp_session_watchdog');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_session_watchdog',
    '*/10 * * * *',
    'SELECT public.invoke_whatsapp_session_watchdog()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_whatsapp_session_watchdog() IS
  'Invokes whatsapp-session-watchdog every 10 minutes via pg_net. Reconciles '
  'Uazapi-reported session state with whatsapp_instances.session_dead_since.';
