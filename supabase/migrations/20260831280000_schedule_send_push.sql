-- Agenda o `send-push`. Issue #1893.
--
-- De minuto em minuto: push que chega dez minutos depois da mensagem não é
-- notificação, é histórico. E a fila só contém quem NÃO tem aba viva, então o
-- custo de olhar com frequência é baixo — na maior parte das passadas ela vem
-- vazia.
--
-- INERTE SEM SECRETS: sem VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nos secrets da
-- edge function, a função responde 500 e nada sai. Provisionar é passo manual,
-- fora de migration — credencial não entra em git.

CREATE OR REPLACE FUNCTION public.invoke_send_push()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  worker_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/send-push';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';

  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION
  -- Mesmo padrão das outras invoke_*: exceção aqui só sujaria
  -- cron.job_run_details. A saúde do disparo é vigiada pelo cron-health-check,
  -- que desde #1886 avisa de verdade em vez de só registrar.
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_send_push() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invoke_send_push() IS
  'Dispara a edge function send-push via pg_net. Chamada pelo cron send-push a cada minuto.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('send-push')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-push');
    PERFORM cron.schedule('send-push', '* * * * *', 'SELECT public.invoke_send_push()');
  END IF;
END
$$;
