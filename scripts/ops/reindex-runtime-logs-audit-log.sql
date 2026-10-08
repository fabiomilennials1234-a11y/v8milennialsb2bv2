-- PASSO OPERACIONAL — REINDEX CONCURRENTLY (Fase 1, OOM 2026-10-05)
--
-- NÃO é migration: não muda esquema, só reconstrói índices inchados.
-- Rodar por psql, autocommit, UM statement por vez (REINDEX CONCURRENTLY não
-- roda em transação), fora do pico (antes de 11h UTC), com lock_timeout:
--
--   PGOPTIONS="-c lock_timeout=3s" psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/ops/reindex-runtime-logs-audit-log.sql
--
-- QUANDO
--   runtime_logs: D+2 depois do deploy do degrau 1 do logger (whatsapp-webhook)
--     E das migrations 20271107130001..3 — ou seja, quando o volume novo já
--     caiu e a purga (job 90, webhook >2 d) já levou o grosso antigo.
--   audit_log: a qualquer momento. 99 MB de índice para ~45k linhas é inchaço
--     do DELETE por ctid do job 82, não volume.
--
-- ANTES (registrar o tamanho para o antes/depois):
--   SELECT indexrelid::regclass, pg_size_pretty(pg_relation_size(indexrelid))
--     FROM pg_index WHERE indrelid IN ('public.runtime_logs'::regclass, 'public.audit_log'::regclass)
--    ORDER BY pg_relation_size(indexrelid) DESC;
--
-- SE CAIR NO MEIO: o REINDEX CONCURRENTLY deixa um índice `<nome>_ccnew`
-- INVALID. Achar e dropar antes de repetir:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
--   DROP INDEX CONCURRENTLY public.<nome>_ccnew;
--
-- Metas do arquiteto: índices de runtime_logs <60 MB e tabela <200 MB em D+2.
-- O heap não encolhe com REINDEX; se a tabela seguir >200 MB, decidir à parte
-- (pg_repack não está habilitado; VACUUM FULL trava a tabela — não usar).

-- runtime_logs (os que sobram depois de 1B; pkey e parciais pequenos inclusos)
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_module_action_time;
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_module_created;
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_entity;
REINDEX INDEX CONCURRENTLY public.runtime_logs_pkey;

-- audit_log (os 5 índices; o de purga é o que o DELETE do job 82 mais incha)
REINDEX INDEX CONCURRENTLY public.idx_audit_log_occurred_at_purge;
REINDEX INDEX CONCURRENTLY public.idx_audit_log_row_time;
REINDEX INDEX CONCURRENTLY public.idx_audit_log_table_time;
REINDEX INDEX CONCURRENTLY public.idx_audit_log_org_time;
REINDEX INDEX CONCURRENTLY public.audit_log_pkey;
