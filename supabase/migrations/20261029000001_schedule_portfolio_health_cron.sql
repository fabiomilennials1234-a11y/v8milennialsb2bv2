-- =============================================================================
-- Schedule calculate-portfolio-health edge function via pg_cron + pg_net
-- Runs every 30 minutes to recalculate health scores, segments, trends
-- =============================================================================

-- 1. Wrapper function (reads URL + secret from cron_config)
CREATE OR REPLACE FUNCTION public.invoke_calculate_portfolio_health()
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
    RAISE LOG 'calculate-portfolio-health: missing cron_config (campaign_rule_dispatch_url or cron_secret)';
    RETURN;
  END IF;

  -- Derive base URL from campaign_rule_dispatch_url (strip function name, append ours)
  v_url := regexp_replace(v_url, '/functions/v1/[^/]+$', '/functions/v1/calculate-portfolio-health');

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$$;

-- 2. Schedule: every 30 minutes, staggered at :40s to avoid contention
SELECT cron.schedule(
  'calculate-portfolio-health',
  '*/30 * * * *',
  $$SELECT pg_sleep(40); SELECT public.invoke_calculate_portfolio_health()$$
);
