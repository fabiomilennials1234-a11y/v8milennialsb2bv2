-- Migration: Configuração opcional para pg_cron chamar process-webhook-deliveries
-- Description: Cria tabela de config e job cron. Requer extensões pg_cron e pg_net.
-- Para ativar: insira a URL da Edge Function e o CRON_SECRET em cron_config.
-- Exemplo (substitua PROJECT_REF e CRON_SECRET):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('webhook_worker_url', 'https://PROJECT_REF.supabase.co/functions/v1/process-webhook-deliveries'),
--     ('cron_secret', 'seu-cron-secret')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- Date: 2026-02-11

-- Tabela opcional para URL e secret do worker (evita hardcode na migration)
CREATE TABLE IF NOT EXISTS public.cron_config (
  key TEXT PRIMARY KEY,
  value TEXT
);

COMMENT ON TABLE public.cron_config IS 'Config para jobs cron (ex: webhook_worker_url, cron_secret). Apenas service role ou admin.';

-- RLS: apenas service role pode ler/escrever (usuários não acessam)
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_config_service_role_only"
  ON public.cron_config FOR ALL
  USING (false)
  WITH CHECK (false);

-- Função que chama a Edge Function (usa pg_net se disponível)
CREATE OR REPLACE FUNCTION public.invoke_process_webhook_deliveries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'webhook_worker_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  -- pg_net: envia request HTTP (requer extensão pg_net)
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

COMMENT ON FUNCTION public.invoke_process_webhook_deliveries IS 'Chama a Edge Function process-webhook-deliveries. Configure webhook_worker_url e cron_secret em cron_config.';

-- Agendar job (requer extensão pg_cron)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-webhook-deliveries',
      '* * * * *',
      'SELECT public.invoke_process_webhook_deliveries()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
