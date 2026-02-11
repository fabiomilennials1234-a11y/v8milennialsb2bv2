-- Migration: pg_cron para campaign-rule-dispatch (regras de envio por etapa)
-- Requer extensões pg_cron e pg_net (cron_config já existe a partir de 20260211000002_webhooks_cron).
-- Para ativar: insira em cron_config a URL da Edge Function e o cron_secret (pode ser o mesmo do webhook).
-- Exemplo (substitua PROJECT_REF):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('campaign_rule_dispatch_url', 'https://PROJECT_REF.supabase.co/functions/v1/campaign-rule-dispatch'),
--     ('cron_secret', 'seu-cron-secret')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Date: 2026-03-10

-- Função que chama a Edge Function campaign-rule-dispatch (usa pg_net se disponível)
CREATE OR REPLACE FUNCTION public.invoke_campaign_rule_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
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

COMMENT ON FUNCTION public.invoke_campaign_rule_dispatch IS 'Chama a Edge Function campaign-rule-dispatch. Configure campaign_rule_dispatch_url e cron_secret em cron_config.';

-- Agendar job (requer extensão pg_cron)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'campaign-rule-dispatch',
      '* * * * *',
      'SELECT public.invoke_campaign_rule_dispatch()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
