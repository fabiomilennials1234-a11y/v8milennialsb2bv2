-- 20261119000017_storage_retention_jobs.sql
--
-- Variação A (fixes "feito burro") — retenção de storage write-only/observabilidade.
-- Aplicado em prod (jsjsm) 2026-06-09 via execute_sql; este arquivo é o registro
-- idempotente (cron.schedule por nome substitui). Limpezas one-time (VACUUM FULL,
-- NULL backfill em lotes) foram operacionais, não migration.
--
-- Contexto: re-análise multi-agente achou storage inchado por dados nunca lidos
-- por código de prod:
--   - whatsapp_messages.raw_payload (~1GB TOAST): dump bruto do webhook, único
--     leitor (message-classifier) é código morto (não importado por ninguém).
--   - agent_decision_logs.capabilities_snapshot: cópia jsonb não-lida (reasoning
--     texto, esse sim exibido, fica). + sem retenção.
--   - cron.job_run_details (377MB): check_cron_job_health varria a tabela inteira
--     a cada 5min (4000ms). Retenção 7d→1d derruba p/ ~3MB / função p/ 14ms.

-- ── cron.job_run_details: retenção 1d (a função de health só olha 10-15min) ──
SELECT cron.schedule('cron-job-run-details-retention', '17 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day'$$);

-- ── agent_decision_logs: purge 30d + NULL da cópia jsonb não-lida em linhas >1d ──
SELECT cron.schedule('agent-decision-logs-retention', '23 3 * * *',
  $$DELETE FROM public.agent_decision_logs WHERE created_at < now() - interval '30 days';
    UPDATE public.agent_decision_logs SET capabilities_snapshot = NULL
      WHERE capabilities_snapshot IS NOT NULL AND created_at < now() - interval '1 day';$$);

-- ── whatsapp_messages.raw_payload: TTL 14d (debug de incidente é sempre recente) ──
-- O backfill inicial (~470k linhas legadas) foi feito em lotes via cron one-shot
-- 'raw_payload_purge_catchup' (self-removing) p/ não travar o webhook write-hot.
SELECT cron.schedule('raw-payload-retention', '33 3 * * *',
  $$UPDATE public.whatsapp_messages SET raw_payload = NULL
    WHERE raw_payload IS NOT NULL AND "timestamp" < now() - interval '14 days'$$);
