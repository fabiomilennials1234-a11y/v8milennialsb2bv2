-- ROLLBACK de 20270804000001_voip_recording_retention.sql
--
-- Desfaz o expurgo de 90 dias e o reenfileiramento da busca: derruba o cron, o
-- invocador, as quatro funções de sistema e a de espaçamento, e devolve os dois
-- CHECK de `recording_status` ao vocabulário de três estados da S2.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, E POR QUÊ
-- -------------------------------------
-- 1. NÃO apaga objeto nenhum do bucket, e nem poderia: `storage.protect_delete`
--    barra DELETE em `storage.objects` vindo do SQL. Rollback de schema não
--    destrói áudio de conversa com cliente.
--
-- 2. NÃO ressuscita o áudio já expurgado. O expurgo é irreversível por
--    construção — é o ponto dele. Uma linha que ficou `purged` perdeu o
--    endereço e o arquivo; este rollback só desliga a máquina que faz isso,
--    daqui para a frente.
--
-- 3. NÃO derruba as COLUNAS por padrão. `recording_purged_at` é a única prova
--    de que aquela gravação existiu e foi apagada dentro da política — perdê-la
--    faz a linha voltar a parecer "nunca gravada", que é justamente a confusão
--    que a fatia veio desfazer. As colunas ficam inertes. O bloco comentado no
--    fim derruba tudo, e exige autorização explícita como todo DROP COLUMN
--    neste projeto.
--
-- 4. NÃO desfaz `torquecalls-webhook`. A troca de `fn_voip_recording_failed`
--    por `fn_voip_recording_fetch_failed` em `_shared/voip/recording.ts` é
--    código, não schema: reverter é reverter o commit e reimplantar a função.
--    ORDEM OBRIGATÓRIA: reimplante a edge function ANTES de rodar este arquivo,
--    senão a tentativa inline chama uma função que já não existe e toda falha
--    de busca vira erro em vez de estado.

-- ===========================================================================
-- 1. O cron e o invocador
-- ===========================================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'torquecalls-recording-maintenance') THEN
    PERFORM cron.unschedule('torquecalls-recording-maintenance');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.invoke_torquecalls_recording_maintenance();

-- ===========================================================================
-- 2. As funções da fatia
-- ===========================================================================
-- `fn_voip_recording_retry_claim` primeiro: é a única que depende de
-- `fn_voip_recording_retry_delay`, e derrubar a dependente antes evita um
-- estado intermediário em que a fila existe sem saber espaçar.
DROP FUNCTION IF EXISTS public.fn_voip_recording_retry_claim(integer);
DROP FUNCTION IF EXISTS public.fn_voip_recording_fetch_failed(uuid, text);
DROP FUNCTION IF EXISTS public.fn_voip_recording_retry_delay(integer);
DROP FUNCTION IF EXISTS public.fn_voip_recording_purged(uuid);
DROP FUNCTION IF EXISTS public.fn_voip_recording_purge_candidates(integer);

-- ===========================================================================
-- 3. Os índices
-- ===========================================================================
DROP INDEX IF EXISTS public.idx_voip_calls_recording_purge;
DROP INDEX IF EXISTS public.idx_voip_calls_recording_retry;

-- ===========================================================================
-- 4. Os CHECK voltam ao vocabulário de três estados
-- ===========================================================================
-- ATENÇÃO: se alguma linha já foi expurgada, ela está com
-- `recording_status = 'purged'` e este bloco a deixaria fora do CHECK novo.
-- Como o CHECK entra NOT VALID, a linha antiga sobrevive e só as escritas novas
-- são conferidas — de propósito. Sem o NOT VALID, um rollback depois do
-- primeiro expurgo falharia no meio, que é a pior hora para falhar.
ALTER TABLE public.voip_calls DROP CONSTRAINT IF EXISTS voip_calls_recording_status_chk;
ALTER TABLE public.voip_calls
  ADD CONSTRAINT voip_calls_recording_status_chk
  CHECK (recording_status IS NULL
         OR recording_status IN ('processing', 'ready', 'failed')) NOT VALID;

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_recording_status_chk;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_recording_status_chk
  CHECK (recording_status IS NULL
         OR recording_status IN ('processing', 'ready', 'failed')) NOT VALID;

COMMENT ON COLUMN public.voip_calls.recording_status IS
  'NULO = não houve gravação (não atendida, ou gravação desligada na VPS). '
  'processing = anunciada, o CRM está buscando. ready = no bucket '
  'call-recordings, endereço em recording_path. failed = não vai haver, causa '
  'em recording_failure_reason. AUSÊNCIA E FALHA SÃO ESTADOS DIFERENTES: com um '
  'só, o gestor não sabe se espera ou se desiste.';

-- ===========================================================================
-- 5. AS COLUNAS — só com autorização explícita
-- ===========================================================================
-- Descomente APENAS se a decisão for apagar a trilha de expurgo e de
-- retentativa. Irreversível sem backup.
--
-- ALTER TABLE public.voip_calls
--   DROP COLUMN IF EXISTS recording_purged_at,
--   DROP COLUMN IF EXISTS recording_refetch_count,
--   DROP COLUMN IF EXISTS recording_last_attempt_at,
--   DROP COLUMN IF EXISTS recording_fetch_abandoned_at;
