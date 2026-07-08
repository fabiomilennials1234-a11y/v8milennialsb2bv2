-- 20270203000000_autovacuum_tuning_hot_tables.sql
--
-- Fase 1 higiene (Dossiê DB — Saúde e Roadmap). 6 tabelas write/update-hot
-- acumulavam 11-20% dead tuples sob autovacuum_vacuum_scale_factor default 0.2
-- (autovacuum só dispara a 20% dead → bloat + planos piores + páginas quentes
-- despejadas do cache). Baixa o gatilho pra 0.05 (0.10 no gigante).
--
-- Medido 2026-07-08 (dead% / upds / último autovacuum):
--   pipeline_entries        16.2% / 75K  / 7 DIAS sem autovacuum (drag hot-path)
--   workflow_executions     19.6% / 140K / 2d
--   whatsapp_media_jobs     18.0% / 296K / 1d
--   agent_decision_logs     14.8% / 10K  / 4d
--   whatsapp_health_checks  14.3% / del-heavy / 1d
--   whatsapp_messages       11.1% / 2.1M / 5d  (1.46M linhas, 1GB heap → 0.10)
--
-- ALTER TABLE ... SET (storage params) = lock SHARE UPDATE EXCLUSIVE: NÃO
-- bloqueia SELECT/INSERT/UPDATE/DELETE, só outro DDL/vacuum, e é instantâneo.
-- Reversível: ALTER TABLE ... RESET (...). Zero risco.
--
-- Autovacuum é throttled por custo global (autovacuum_vacuum_cost_delay/limit),
-- então gatilho mais frequente NÃO estoura I/O — enfileira no orçamento.
--
-- APLICADO EM PROD via execute_sql (autorização CTO na sessão). Registrar em
-- supabase_migrations.schema_migrations (version 20270203000000).

ALTER TABLE public.pipeline_entries       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.workflow_executions    SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.whatsapp_media_jobs    SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.agent_decision_logs    SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.whatsapp_health_checks SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.whatsapp_messages      SET (autovacuum_vacuum_scale_factor = 0.10, autovacuum_analyze_scale_factor = 0.10);

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- ALTER TABLE public.pipeline_entries       RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.workflow_executions    RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.whatsapp_media_jobs    RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.agent_decision_logs    RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.whatsapp_health_checks RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.whatsapp_messages      RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
