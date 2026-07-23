-- =====================================================
-- Meta Token Refresh Cron Job
-- Renova tokens Meta que expiram em menos de 7 dias.
-- Roda diariamente as 02:00 UTC.
-- =====================================================

CREATE OR REPLACE FUNCTION public.invoke_refresh_meta_tokens()
RETURNS void AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'refresh-meta-tokens');

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[meta-cron] cron_config missing for refresh-meta-tokens';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[meta-cron] invoke_refresh_meta_tokens failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Register cron job (daily at 02:00 UTC)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh-meta-tokens')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-meta-tokens');

    PERFORM cron.schedule(
      'refresh-meta-tokens',
      '0 2 * * *',
      'SELECT public.invoke_refresh_meta_tokens()'
    );
  END IF;
END $outer$;
