-- 20260609120000_unstagger_remove_pg_sleep.sql
--
-- Remove o prefixo `pg_sleep(N);` dos cron jobs "staggered".
--
-- Problema medido em prod (jsjsm, 2026-06-09):
--   8+ jobs '* * * * *' rodam `SELECT pg_sleep(5..40); SELECT invoke_*()`.
--   O pg_sleep SEGURA uma conexão do pool (max 60) OCIOSA por 5-40s. No topo
--   de cada minuto isso aperta o pool e derruba execuções de cron:
--   ~368 execuções perdidas/24h, 61% concentradas nos minutos mod5=0.
--
-- Por que remover é seguro:
--   - net.http_post (o que os invoke_* realmente fazem) é fire-and-forget,
--     volta em ms — não precisa de stagger pra não "estourar rate limit".
--   - O motivo original do sleep era lock contention em cron.job_run_details
--     (audit log do pg_cron). Isso é endereçado aqui pela RETENÇÃO dessa
--     tabela (hoje 377MB / ~1M linhas, responsável por ~95.7% do disk-read).
--   - Stagger por sleep era um anti-padrão: segurar conexão escassa parada.
--     O caminho correto (futuro) é cron.use_background_workers=on, que isola
--     os jobs do pool de query — fica para a fase de rearquitetura.
--
-- Reversível: rerun de 20260427210000_stagger_pg_cron_jobs.sql reaplica os sleeps.
-- Idempotente: só reescreve jobs cujo comando ainda contém pg_sleep(.

DO $outer$
DECLARE
  v_job   RECORD;
  v_clean TEXT;
  v_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not present — skipping';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobid, jobname, schedule, command
    FROM cron.job
    WHERE command ~* 'pg_sleep\s*\('
  LOOP
    v_clean := v_job.command;
    -- remove marcador de comentário do stagger
    v_clean := regexp_replace(v_clean, '^--\s*staggered:\d+s\s*\n', '', 'n');
    -- remove qualquer `SELECT pg_sleep(N);` (início OU meio — pega os 3 jobs
    -- que ganharam sleep fora do array da migration original)
    v_clean := regexp_replace(v_clean, 'SELECT\s+pg_sleep\s*\(\s*\d+\s*\)\s*;\s*', '', 'gi');
    v_clean := btrim(v_clean);

    IF v_clean IS DISTINCT FROM v_job.command AND length(v_clean) > 0 THEN
      PERFORM cron.unschedule(v_job.jobname);
      PERFORM cron.schedule(v_job.jobname, v_job.schedule, v_clean);
      v_count := v_count + 1;
      RAISE NOTICE 'unstaggered job % (id %)', v_job.jobname, v_job.jobid;
    END IF;
  END LOOP;

  RAISE NOTICE 'Removed pg_sleep from % cron jobs', v_count;
END $outer$;

-- ── Retenção de cron.job_run_details ────────────────────────────────────────
-- Hoje sem retenção: ~1M linhas / 377MB, dominando o disk-read do DB e
-- inflando check_cron_job_health (varre a tabela inteira).
-- Job diário (7 dias de janela é folgado para debug). A limpeza inicial das
-- ~970k linhas legadas foi feita em lotes fora desta migration (DELETE síncrono
-- de 1M linhas estoura timeout/lock — não cabe em DDL transacional).
SELECT cron.schedule(
  'cron-job-run-details-retention',
  '17 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);
