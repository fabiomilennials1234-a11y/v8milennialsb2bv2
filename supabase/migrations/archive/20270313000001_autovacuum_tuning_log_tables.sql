-- 20270313000001_autovacuum_tuning_log_tables.sql
--
-- RAM reclaim (feat/db-ram-reclaim) — complemento de 20270203000000. Duas tabelas
-- de log DELETE-heavy (retenção por cron a cada 10 min) seguem no
-- autovacuum_vacuum_scale_factor DEFAULT 0.2 → autovacuum só dispara a 20% dead,
-- deixando bloat acumular e ratcheting o high-water-mark do arquivo (páginas
-- quentes despejadas do cache). Baixa o gatilho pra 0.05 (mesma dose das outras
-- tabelas churny já tunadas em #1012: health_checks, media_jobs, dlq).
--
-- Medido em PROD (jsjsmuncfkbsbzqzqhfq, 2026-07-13) — reloptions=NULL (não tunadas)
-- + índices INCHADOS (o file HWM nunca encolheu):
--   audit_log      77K linhas | heap 125 MB | idx 137 MB (row_time 64 MB)
--   runtime_logs  148K linhas | heap  81 MB | idx 127 MB (10 índices; module_action_time 41 MB)
-- (Já em 0.05: whatsapp_health_checks, whatsapp_media_jobs, whatsapp_webhook_dlq;
--  whatsapp_messages em 0.10.)
--
-- Esta migration só PREVINE regrowth futuro. O bloat JÁ acumulado (HWM alto) só
-- volta ao SO com REINDEX/VACUUM FULL — ver RUNBOOK.md deste slice.
--
-- ALTER TABLE ... SET (storage params) = lock SHARE UPDATE EXCLUSIVE: NÃO bloqueia
-- SELECT/INSERT/UPDATE/DELETE, só outro DDL/vacuum, e é instantâneo. Reversível
-- via RESET. Autovacuum é throttled por custo global → gatilho mais frequente NÃO
-- estoura I/O, enfileira no orçamento. Zero risco.
--
-- APLICAR: roda em transação normal (dev-first; prod só com "vai" do CTO).
-- Registrar em supabase_migrations.schema_migrations (version 20270313000001).

ALTER TABLE public.audit_log    SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.runtime_logs SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- ALTER TABLE public.audit_log    RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- ALTER TABLE public.runtime_logs RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
