-- Migration: pg_cron para process-copilot-followups (follow-ups Copilot no_response)
-- Requer extensões pg_cron e pg_net (mesmas do outbound).
--
-- Para ativar: insira em cron_config a URL (pode usar o mesmo cron_secret dos outros jobs).
-- Exemplo (substitua PROJECT_REF):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('process_copilot_followups_url', 'https://PROJECT_REF.supabase.co/functions/v1/process-copilot-followups')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- O job roda a cada 5 minutos. Processa regras no_response: leads sem resposta há X tempo,
-- respeitando horário comercial e max_followups.
-- Date: 2026-03-13

CREATE OR REPLACE FUNCTION public.invoke_process_copilot_followups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_copilot_followups_url';
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

COMMENT ON FUNCTION public.invoke_process_copilot_followups IS 'Chama a Edge Function process-copilot-followups. Configure process_copilot_followups_url e cron_secret em cron_config.';

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-copilot-followups',
      '*/5 * * * *',
      'SELECT public.invoke_process_copilot_followups()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
