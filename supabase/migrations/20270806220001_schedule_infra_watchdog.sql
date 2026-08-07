-- 20270806220001_schedule_infra_watchdog.sql
--
-- Agenda o `infra-watchdog`, que vigia três coisas que passaram despercebidas:
--   - pressão do pool de conexões (o apagão de 42 min em 2026-08-06);
--   - saúde do aviso de Chamado novo (401 silencioso por 23 dias, 35 chamados
--     sem ninguém avisado);
--   - importação de histórico volumosa em curso.
--
-- Depende de `db_connection_pressure()`, criada em
-- 20270806220000_history_sync_guardrails.sql — aplicar as duas na ordem.
--
-- INERTE SEM SECRETS. O watchdog só consegue avisar se `WATCHDOG_UAZAPI_TOKEN`
-- e `WATCHDOG_WHATSAPP_JID` (ou as do suporte, como reserva) estiverem
-- configuradas nos secrets da edge function. Sem elas ele roda, detecta e
-- registra em `runtime_logs` — mas não envia nada. Provisionar as secrets é
-- passo manual, fora de migration, porque credencial não entra em git.

CREATE OR REPLACE FUNCTION public.invoke_infra_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  worker_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/infra-watchdog';
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
  -- Este engole-tudo segue o padrão das outras `invoke_*` do projeto: um cron
  -- que levanta exceção fica marcado como falho e polui `cron.job_run_details`.
  -- Aqui o silêncio é aceitável porque a função não decide nada — só dispara o
  -- POST. Vale notar, ainda assim, que um watchdog mudo é um risco em si: se o
  -- pg_net parar, ninguém fica sabendo. A rede de segurança para isso é o
  -- `cron-health-monitor`, que já observa a saúde dos jobs.
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_infra_watchdog() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invoke_infra_watchdog() IS
  'Dispara a edge function infra-watchdog via pg_net. Chamada pelo cron '
  'infra-watchdog a cada 2 minutos.';

-- A cada 2 minutos: rápido o bastante para pegar uma saturação enquanto ela
-- ainda é reversível (a de 06/08 levou ~20 min entre o primeiro sinal e o
-- colapso), e espaçado o bastante para o custo ser irrelevante. O cooldown de
-- 30 min por assunto, dentro da própria função, é o que evita repetição.
SELECT cron.schedule(
  'infra-watchdog',
  '*/2 * * * *',
  $$SELECT public.invoke_infra_watchdog()$$
);
