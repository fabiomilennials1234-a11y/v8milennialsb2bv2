-- ROLLBACK de 20270806220000_history_sync_guardrails.sql
--
-- Desfaz os guard-rails do backfill de histórico: some o medidor de pressão, o
-- contador de escrita por organização e o estado 'cancelled'.
--
-- ORDEM DE EXECUÇÃO — LEIA ANTES
-- ------------------------------
-- Este arquivo pressupõe que o `history-sync-worker` JÁ FOI revertido para a
-- versão anterior. Rodar isto com o worker novo ainda em produção deixa o worker
-- chamando `db_connection_pressure()` e `history_sync_consume_budget()` que não
-- existem mais — ele trata a ausência como "sem pressão" e volta a escrever sem
-- freio, que é exatamente o comportamento que causou o incidente de 2026-08-06.
-- Reverta a edge function primeiro.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, E POR QUÊ
-- -------------------------------------
-- 1. NÃO reverte jobs que estejam em 'cancelled' para outro estado. O CHECK volta
--    a recusar o valor, então esses jobs passariam a violar a constraint em
--    qualquer UPDATE futuro. Por isso o passo 1 abaixo os converte para 'failed',
--    que é o estado terminal mais próximo e preserva a intenção do operador
--    (o job não deve mais rodar). Converter para 'queued' seria pior: ressuscitaria
--    importações que alguém abortou de propósito.
-- 2. NÃO remove as chaves de `cron_config`. São cinco linhas de texto inertes;
--    se a migration for reaplicada depois, o ON CONFLICT DO NOTHING preserva
--    qualquer ajuste que tenha sido feito à mão durante um incidente. Apagá-las
--    destruiria essa calibração sem ganho nenhum.

-- 1. Esvaziar o estado que a constraint deixará de aceitar.
UPDATE public.history_sync_jobs
   SET status = 'failed',
       error = COALESCE(error, '') || ' [rollback: estado cancelled removido do schema]'
 WHERE status = 'cancelled';

-- 2. CHECK volta ao conjunto original de estados.
ALTER TABLE public.history_sync_jobs
  DROP CONSTRAINT IF EXISTS history_sync_jobs_status_check;

ALTER TABLE public.history_sync_jobs
  ADD CONSTRAINT history_sync_jobs_status_check
  CHECK (status = ANY (ARRAY[
    'queued'::text,
    'running'::text,
    'paused'::text,
    'completed'::text,
    'failed'::text
  ]));

COMMENT ON COLUMN public.history_sync_jobs.status IS NULL;

-- 3. Cron do balde some antes da tabela, senão o job passa a falhar de minuto em
--    minuto contra uma relação inexistente.
SELECT cron.unschedule('history-sync-budget-cleanup')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'history-sync-budget-cleanup');

-- 4. Contador de escrita e sua RPC.
DROP FUNCTION IF EXISTS public.history_sync_consume_budget(uuid, integer);
DROP TABLE IF EXISTS public.history_sync_write_budget;

-- 5. Medidor de pressão.
DROP FUNCTION IF EXISTS public.db_connection_pressure();
