-- Fix: invoke_process_scheduled_user_messages 401 em prod
--
-- Diagnóstico (2026-04-26): cron acumulava ~150 401/h em pg_net._http_response.
-- Function process-scheduled-user-messages tem verify_jwt=true (default
-- Supabase em functions sem config.toml local — drift entre prod e código).
-- Cron envia apenas x-cron-secret, sem Authorization Bearer → 401.
--
-- Test: curl com Authorization: Bearer <anon> + x-cron-secret retorna 200
-- (processed:1, sent:0, failed:1).
--
-- Fix: armazenar anon_key em cron_config (anon é pública, vai pro frontend
-- — sem leak de secret) + atualizar invoke fn pra enviar Bearer.

INSERT INTO public.cron_config (key, value)
VALUES (
  'supabase_anon_key',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzanNtdW5jZmtic2J6cXpxaGZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTg3ODEsImV4cCI6MjA4NDc5NDc4MX0.rwmZh_bLyRIluqo0KN2TsK1PR2S0TriduUOzQ_RnaKQ'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_user_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
  anon_key TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_scheduled_user_messages_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  SELECT value INTO anon_key FROM public.cron_config WHERE key = 'supabase_anon_key';

  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, ''),
      'Authorization', 'Bearer ' || COALESCE(anon_key, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;
