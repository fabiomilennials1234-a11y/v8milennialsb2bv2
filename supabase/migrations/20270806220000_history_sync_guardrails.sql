-- 20270806220000_history_sync_guardrails.sql
--
-- INCIDENTE 2026-08-06 — o que esta migration existe para impedir
-- --------------------------------------------------------------
-- Duas importações de histórico de WhatsApp (`history_sync_jobs`) de uma única
-- organização escreveram ~500 mensagens/minuto em `whatsapp_messages` — contra
-- uma linha de base de ~20/min do sistema inteiro. O pool do Postgres (90
-- conexões) esgotou, PostgREST/GoTrue/Realtime pararam de aceitar conexão, e o
-- Cloudflare passou a devolver 522. Das 20:59 às 21:41 UTC nenhuma mensagem de
-- WhatsApp foi gravada — 42 minutos de inbound perdido em silêncio.
--
-- Três defeitos encadeados, endereçados aqui e no worker:
--   1. O backfill não tem freio: nunca pergunta se o banco aguenta.  → esta migration
--   2. Cancelar não cancela: não existe estado terminal de cancelamento, e o
--      reaper de jobs presos devolve todo `running` para `queued`, de modo que
--      um job "cancelado" se ressuscita no tick seguinte.            → esta migration
--   3. Os tetos de volume não valem para `scope = 'full'`.           → worker (TS)
--
-- Esta migration é ADITIVA e nasce INERTE: cria o medidor de pressão, admite o
-- novo estado e registra os parâmetros com valores padrão. Nada muda de
-- comportamento até o `history-sync-worker` novo ser deployado.

-- ---------------------------------------------------------------------------
-- 1. Estado terminal de cancelamento
-- ---------------------------------------------------------------------------
-- `paused` já existia mas não é terminal — é "parado, pode retomar". Cancelar é
-- decisão definitiva do operador e precisa de estado próprio, senão a UI não tem
-- como distinguir "pausei para retomar depois" de "aborta isto".

ALTER TABLE public.history_sync_jobs
  DROP CONSTRAINT IF EXISTS history_sync_jobs_status_check;

ALTER TABLE public.history_sync_jobs
  ADD CONSTRAINT history_sync_jobs_status_check
  CHECK (status = ANY (ARRAY[
    'queued'::text,
    'running'::text,
    'paused'::text,
    'cancelled'::text,
    'completed'::text,
    'failed'::text
  ]));

COMMENT ON COLUMN public.history_sync_jobs.status IS
  'queued=aguarda tick | running=em processamento | paused=parado, retomável '
  '| cancelled=abortado pelo operador, terminal | completed | failed. '
  'O worker só coleta ''queued''; o reaper de jobs presos só reanima ''running''. '
  'Ver 20270806220000_history_sync_guardrails.sql.';

-- ---------------------------------------------------------------------------
-- 2. Medidor de pressão do pool de conexões
-- ---------------------------------------------------------------------------
-- `pg_stat_activity` só mostra as conexões dos outros para superusuário ou para
-- quem tem pg_read_all_stats. O worker roda como service_role, que não tem
-- nenhum dos dois — daí SECURITY DEFINER.
--
-- Devolve o mínimo necessário para uma decisão de freio. Nada de query, usuário
-- ou parâmetro de conexão: só contagem agregada. Assim a função não vira um
-- vazamento lateral de quem está fazendo o quê no banco.

CREATE OR REPLACE FUNCTION public.db_connection_pressure()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'used',      count(*),
    'active',    count(*) FILTER (WHERE state = 'active'),
    'idle_in_tx', count(*) FILTER (WHERE state = 'idle in transaction'),
    'max',       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'pct',       round(
                   100.0 * count(*)
                   / GREATEST((SELECT setting::int FROM pg_settings WHERE name = 'max_connections'), 1)
                 )::int,
    'measured_at', now()
  )
  FROM pg_stat_activity
  WHERE backend_type = 'client backend';
$function$;

-- DROP+CREATE de função devolve EXECUTE ao PUBLIC. Aqui é CREATE OR REPLACE, que
-- preserva grants, mas o REVOKE fica explícito para que o estado desejado não
-- dependa de qual dos dois caminhos foi usado.
REVOKE ALL ON FUNCTION public.db_connection_pressure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_connection_pressure() TO service_role;

COMMENT ON FUNCTION public.db_connection_pressure() IS
  'Pressão do pool de conexões, agregada. Usada pelo history-sync-worker para '
  'frear o backfill antes de sufocar o tráfego ao vivo, e pelo alerta de '
  'saturação. service_role apenas — não expor a authenticated.';

-- ---------------------------------------------------------------------------
-- 3. Parâmetros do freio
-- ---------------------------------------------------------------------------
-- Em `cron_config` (e não como constante no TypeScript) porque no meio de um
-- incidente é preciso apertar o freio sem esperar deploy de edge function.
--
-- Os números vêm do incidente, não de chute:
--   - pressure_pct 60: o colapso se deu com o pool cheio; 60% ainda deixa ~36
--     conexões livres para o tráfego ao vivo, que em regime normal usa ~26.
--   - rows_per_min 400: o pico destrutivo foi ~500/min sustentado por 7 minutos.
--     400 é abaixo do que quebrou, e ~20× o tráfego orgânico — uma importação de
--     50 mil mensagens ainda termina em ~2h, invisível para o usuário.
--   - janela 03:00–09:00 UTC = 00:00–06:00 em Brasília: madrugada local para
--     todas as orgs, que são brasileiras.

INSERT INTO public.cron_config (key, value) VALUES
  ('history_sync_max_pressure_pct',   '60'),
  ('history_sync_max_rows_per_min',   '400'),
  ('history_sync_full_window_start',  '3'),
  ('history_sync_full_window_end',    '9'),
  ('db_pressure_alert_pct',           '75')
ON CONFLICT (key) DO NOTHING;  -- nunca sobrescreve ajuste feito à mão em prod

-- ---------------------------------------------------------------------------
-- 4. Contador de escrita por organização
-- ---------------------------------------------------------------------------
-- O teto por minuto precisa de memória entre invocações: o worker é stateless e
-- roda a cada minuto em instância nova. Uma tabela minúscula, com uma linha por
-- organização por minuto, resolve sem depender de Redis.
--
-- Não leva RLS com policy de tenant: é telemetria de infraestrutura, escrita e
-- lida só por service_role. RLS habilitada sem policy = deny-all para
-- authenticated e anon, que é exatamente o desejado.

CREATE TABLE IF NOT EXISTS public.history_sync_write_budget (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  minute_bucket   timestamptz NOT NULL,
  rows_written    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, minute_bucket)
);

ALTER TABLE public.history_sync_write_budget ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.history_sync_write_budget FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.history_sync_write_budget IS
  'Consumo de escrita do backfill de histórico, por org e por minuto. '
  'Telemetria de infra: service_role apenas, RLS sem policy = deny-all. '
  'Purgada por cron; ver job history-sync-budget-cleanup.';

-- Reserva de cota e leitura do saldo numa tacada só. Feita como RPC (e não como
-- SELECT+UPDATE no worker) porque duas invocações concorrentes do mesmo minuto
-- precisam ver o mesmo contador — o INSERT ... ON CONFLICT DO UPDATE serializa
-- no lock da linha e devolve o total já somado.
CREATE OR REPLACE FUNCTION public.history_sync_consume_budget(
  p_organization_id uuid,
  p_rows integer
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.history_sync_write_budget (organization_id, minute_bucket, rows_written)
  VALUES (p_organization_id, date_trunc('minute', now()), GREATEST(p_rows, 0))
  ON CONFLICT (organization_id, minute_bucket)
  DO UPDATE SET rows_written = public.history_sync_write_budget.rows_written + GREATEST(p_rows, 0)
  RETURNING rows_written;
$function$;

REVOKE ALL ON FUNCTION public.history_sync_consume_budget(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.history_sync_consume_budget(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.history_sync_consume_budget(uuid, integer) IS
  'Soma p_rows ao balde do minuto corrente da org e devolve o total acumulado. '
  'Chamar com p_rows=0 para consultar sem consumir.';

-- O balde é descartável: só o minuto corrente importa. Retenção de 1h dá folga
-- para depurar um incidente sem deixar a tabela crescer.
SELECT cron.schedule(
  'history-sync-budget-cleanup',
  '*/15 * * * *',
  $$DELETE FROM public.history_sync_write_budget WHERE minute_bucket < now() - interval '1 hour'$$
);
