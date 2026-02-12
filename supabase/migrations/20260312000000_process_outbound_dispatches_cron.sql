-- Migration: pg_cron para process-outbound-dispatches (disparos Copilot agendados)
-- Requer extensões pg_cron e pg_net. Se schema "cron" não existir, habilite no Dashboard:
--   Database → Extensions → procure "pg_cron" e "pg_net" → Enable
--
-- Para ativar: insira em cron_config a URL e o secret (pode ser o mesmo dos outros jobs).
-- Exemplo (substitua PROJECT_REF e seu CRON_SECRET):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('process_outbound_dispatches_url', 'https://PROJECT_REF.supabase.co/functions/v1/process-outbound-dispatches'),
--     ('cron_secret', 'seu-cron-secret')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- O job roda a cada 5 minutos para processar outbound_dispatch_log com status=pending e scheduled_at <= now().
-- Date: 2026-03-12

-- Garantir que cron_config existe (criada em 20260211000002_webhooks_cron)
CREATE TABLE IF NOT EXISTS public.cron_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Função que chama a Edge Function process-outbound-dispatches (usa pg_net se disponível)
CREATE OR REPLACE FUNCTION public.invoke_process_outbound_dispatches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_outbound_dispatches_url';
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

COMMENT ON FUNCTION public.invoke_process_outbound_dispatches IS 'Chama a Edge Function process-outbound-dispatches. Configure process_outbound_dispatches_url e cron_secret em cron_config.';

-- Agendar job (requer extensão pg_cron habilitada)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-outbound-dispatches',
      '*/5 * * * *',
      'SELECT public.invoke_process_outbound_dispatches()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
