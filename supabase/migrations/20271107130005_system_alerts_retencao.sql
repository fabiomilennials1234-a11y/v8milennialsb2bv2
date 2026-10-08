-- system_alerts · 1C — retenção: alerta JÁ RESOLVIDO e CRIADO há mais de 30 dias
--
-- TIMESTAMP PROVISÓRIO: renumerar contra o ledger de prod na hora de aplicar.
-- Transacional: pode ir por apply_migration (não tem CONCURRENTLY).
--
-- Medido em prod em 2026-10-05: 110.607 linhas, todas `cron_job_failure`,
-- 0 sem resolver, desde 2026-04-28, 96 MB, sem retenção nenhuma.
--
-- PREDICADO (decisão do orchestrador, 2026-10-05):
--   resolved_at IS NOT NULL AND created_at < now() - 30 dias
-- A idade conta pela CRIAÇÃO, não pela resolução: 110.586 linhas foram
-- resolvidas em LOTE em 2026-10-01 (varredura do 20271101000000), e um
-- predicado por `resolved_at` só agiria a partir de 31/10. Por `created_at`
-- age no primeiro dia: 94.214 linhas elegíveis em 2026-10-05, drenadas em
-- ~19 h (5.000/h).
--
-- Nunca apaga alerta aberto (`resolved_at IS NULL`), seja qual for a idade.
--
-- LEITORES (verificado em 2026-10-05, prod via MCP só SELECT + repo): nenhum
-- depende de histórico RESOLVIDO; todos leem só alerta ABERTO.
--   - `AlertsBanner.tsx:22` → `useSystemAlerts({ resolved: false })`.
--   - `MasterAutomationHealth.tsx:365` → `useSystemAlerts({ resolved: false })`.
--   - `useAutomationHealth.ts:41` → contagem com `resolved_at IS NULL`;
--     `:161-171` aceita `resolved:true`, mas nenhum chamador passa; `:185` é o
--     UPDATE que resolve.
--   - `check_cron_job_health` (prod): SELECT só com `resolved_at IS NULL`;
--     o resto é INSERT e o UPDATE que resolve.
--   - `retry-dead-letter-jobs/index.ts:143-152`: dedup com `resolved_at IS
--     NULL` e janela de 24 h. `process-webhook-deliveries`: só INSERT.
--   - Nenhuma view, matview ou cron.job de prod referencia system_alerts.
--
-- Lote: 5.000 linhas por execução, por ctid (mesmo padrão de purge_runtime_logs
-- e do job 82), de hora em hora no minuto :50. Minuto escolhido pela carga de
-- `scripts/cron/carga-por-minuto.mjs` sobre o snapshot de prod + o
-- reescalonamento anti-rajada: :50 não tem nenhuma purga pesada (ver
-- PESADAS_RECORRENTES em tests/unit/cron-escalonamento-contrato.test.ts) e o
-- pico do minuto vai de 5 para 6 disparos (TETO do contrato = 8; medição
-- confirmada em prod pelo revisor). O contrato agora LÊ este cron.schedule:
-- tests/unit/cron-escalonamento-contrato.test.ts, "jobs agendados por
-- migrations novas" — mover para um minuto de purga pesada fica vermelho.
--
-- SECURITY INVOKER: o pg_cron roda como `postgres`, dono da tabela. Ninguém
-- mais precisa executar — EXECUTE revogado inclusive de service_role (função
-- nova nasce executável por service_role via default privilege).
--
-- REVERSÃO EXATA:
--   SELECT cron.unschedule('purge-system-alerts-resolvidos');
--   DROP FUNCTION IF EXISTS public.purge_system_alerts_resolvidos();

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_system_alerts_resolvidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  apagadas integer;
BEGIN
  DELETE FROM public.system_alerts
   WHERE ctid IN (
     SELECT ctid FROM public.system_alerts
      WHERE resolved_at IS NOT NULL
        AND created_at < now() - interval '30 days'
      LIMIT 5000
   );
  GET DIAGNOSTICS apagadas = ROW_COUNT;
  RETURN apagadas;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_system_alerts_resolvidos()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.purge_system_alerts_resolvidos() IS
  'Retenção de system_alerts: apaga até 5.000 alertas já resolvidos e criados há mais de 30 dias por chamada. Alerta aberto nunca é apagado. Chamada pelo pg_cron (purge-system-alerts-resolvidos, :50 de hora em hora).';

-- Casa por jobname (cron.schedule com nome faz upsert): reaplicar não duplica.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron ausente — agendamento de purge-system-alerts-resolvidos ignorado';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'purge-system-alerts-resolvidos',
    '50 * * * *',
    'SELECT public.purge_system_alerts_resolvidos()'
  );
END $$;

COMMIT;
