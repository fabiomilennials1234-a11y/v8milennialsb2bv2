-- rollback/20271107140002_cron_dispatch_minute.sql
--
-- Desfaz a M3 numa transação: tira o job do dispatcher, reativa os 19 jobs
-- antigos por jobname (agenda e comando deles nunca mudaram) e remove o
-- dispatcher. Rodar ANTES dos rollbacks da M2 e da M1.
--
-- ⚠ Reativa os 19 incondicionalmente: se algum já estivesse inativo antes da
--   M3, desative-o de novo à mão (em 2026-10-05 os 19 estavam ativos).
-- ⚠ Alertas resolvidos pela M3 ('consolidated_into_cron_dispatch_minute') e
--   pelo dispatcher ('auto_recovered') ficam resolvidos.
-- ⚠ Alerta aberto 'cron-dispatch-minute/<subtarefa>' é resolvido aqui: sem o
--   dispatcher ninguém mais o fecharia.

BEGIN;

DO $$
DECLARE
  v_antigos text[] := ARRAY[
    'voip-reap-authorized', 'voip-sweep-stuck-calls', 'copilot-queue-sweep',
    'copilot_v2_worker', 'process-ai-actions', 'process-workflow-executions',
    'workflow-cron-triggers', 'campaign-rule-dispatch', 'pipe-rule-dispatch',
    'process-scheduled-user-messages', 'history-sync-worker', 'omie-sync-dispatch',
    'process-blast-recipients', 'send-push', 'oraculo-feedback-alerts',
    'mass-send-status-poll', 'whatsapp_media_retry',
    'infra-watchdog', 'billing-provision-worker'
  ];
  v_job record;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — nada a reagendar';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-dispatch-minute') THEN
    PERFORM cron.unschedule('cron-dispatch-minute');
  END IF;

  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = ANY (v_antigos) AND NOT active LOOP
    PERFORM cron.alter_job(job_id := v_job.jobid, active := true);
  END LOOP;
END;
$$;

UPDATE public.system_alerts
   SET resolved_at = now(),
       metadata    = metadata || jsonb_build_object('resolved_reason', 'cron_dispatch_minute_rollback')
 WHERE category = 'cron_job_failure'
   AND resolved_at IS NULL
   AND metadata->>'job_name' LIKE 'cron-dispatch-minute/%';

DROP FUNCTION IF EXISTS public.cron_dispatch_minute(timestamptz);
DROP FUNCTION IF EXISTS public.cron_dispatch_registrar_saude(text[], jsonb);
DROP TABLE IF EXISTS public.cron_dispatch_falhas;

COMMIT;
