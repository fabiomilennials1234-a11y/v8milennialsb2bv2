-- 20270915000010_escalonar_crons_purga_e_indices.sql
--
-- Incidente 2026-09-02, 18:21–18:31 UTC: produção fora do ar por ~10 minutos.
--
-- Sintoma: HTTP 522 em /rest/v1/* e /auth/v1/*. No navegador isso aparece como
-- "blocked by CORS policy: No 'Access-Control-Allow-Origin' header" — não é CORS:
-- um 522 não devolve resposta, logo não devolve header nenhum. O tráfego caiu de
-- ~11.500 req/5min para 294 e os postgres_logs pararam de emitir às 18:21.
--
-- Causa, duas coisas somadas:
--
-- 1. Os DELETE de purga faziam varredura. Nenhuma das tabelas tinha índice que
--    servisse ao predicado de purga: os existentes tinham prefixo errado
--    (instance_id, table_name, organization_id) ou eram parciais no sentido
--    OPOSTO (WHERE resolved_at IS NULL, quando a purga quer IS NOT NULL). Para
--    apagar as 276 linhas elegíveis, varria as 161.818 da tabela, a cada 10 min.
--
-- 2. Os cron de manutenção usavam */5, */10, */15 e */30 ALINHADOS, então
--    coincidiam em :00 e :30 — 44 jobs no mesmo minuto, vários deles pesados.
--
-- Sob contenção, o que leva 0,1 s passa a levar 10 s: medido na janela do
-- incidente, DELETE whatsapp_health_checks 10,8 s, whatsapp_media_jobs 16,2 s,
-- check_cron_job_health() 19,7 s, purge_runtime_logs() 23,8 s. Daí as duas
-- frentes: o índice reduz o trabalho por execução, o escalonamento evita a
-- coincidência.
--
-- ⚠️ JÁ APLICADA EM PROD em 2026-09-02 ~18:55 UTC, com autorização do CTO, via
-- MCP/Management API (índices com CONCURRENTLY, agendamento com cron.alter_job).
-- Escrita aqui para que ambiente novo não nasça com o agendamento antigo — o
-- cron de produção não vive no repo. Em prod os CREATE são no-op pelo IF NOT
-- EXISTS; o bloco de agendamento é idempotente.

BEGIN;

-- ── 1. Índices de purga ────────────────────────────────────────────────────
-- Sem CONCURRENTLY, seguindo a convenção do repo: ele não roda dentro de
-- transação. Em ambiente novo as tabelas nascem vazias, então o lock é
-- instantâneo. Em prod estes índices já existem (criados CONCURRENTLY, com o
-- banco no ar) e o IF NOT EXISTS faz esta migration não tocá-los.

CREATE INDEX IF NOT EXISTS idx_whatsapp_health_checks_purge
  ON public.whatsapp_health_checks (checked_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_media_jobs_purge
  ON public.whatsapp_media_jobs (created_at) WHERE resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at_purge
  ON public.audit_log (occurred_at);

-- ── 2. Escalonamento dos jobs de manutenção ────────────────────────────────
-- Offsets primos entre si: nenhum par de job pesado volta a compartilhar
-- minuto, e nenhum cai em :00 ou :30.
--
--   cron-health-monitor          2,7,12,17,22,27,32,37,42,47,52,57
--   cleanup-wa-health-checks-7d  4,14,24,34,44,54
--   cleanup-audit-log-14d        6,16,26,36,46,56
--   purge-runtime-logs           9,19,29,39,49,59
--   history-sync-budget-cleanup  3,18,33,48
--   purge-copilot-midia-logs     8,23,38,53
--   cleanup-wa-media-jobs-14d    13,28,43,58
--   calculate-portfolio-health   21,51
--
-- Casa por jobname, nunca por jobid: o id não é estável entre ambientes. Job
-- ausente é ignorado em silêncio — ambiente que ainda não agendou aquele job
-- não deve falhar por isso.
DO $$
DECLARE
  alvo record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — escalonamento ignorado';
    RETURN;
  END IF;

  FOR alvo IN
    SELECT * FROM (VALUES
      ('cron-health-monitor',          '2-59/5 * * * *'),
      ('cleanup-wa-health-checks-7d',  '4-59/10 * * * *'),
      ('cleanup-audit-log-14d',        '6-59/10 * * * *'),
      ('purge-runtime-logs',           '9-59/10 * * * *'),
      ('history-sync-budget-cleanup',  '3-59/15 * * * *'),
      ('purge-copilot-midia-logs',     '8-59/15 * * * *'),
      ('cleanup-wa-media-jobs-14d',    '13-59/15 * * * *'),
      ('calculate-portfolio-health',   '21-59/30 * * * *')
    ) AS t(nome, agenda)
  LOOP
    PERFORM cron.alter_job(job_id => j.jobid, schedule => alvo.agenda)
    FROM cron.job j
    WHERE j.jobname = alvo.nome;
  END LOOP;
END $$;

COMMIT;
