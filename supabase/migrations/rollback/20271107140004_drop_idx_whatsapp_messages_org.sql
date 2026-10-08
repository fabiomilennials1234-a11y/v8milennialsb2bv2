-- rollback/20271107140004_drop_idx_whatsapp_messages_org.sql
--
-- Recria o índice com a definição exata de prod (pg_get_indexdef, 2026-10-05).
-- CONCURRENTLY: não roda em transação — psql autocommit, pooler session 5432.
-- Se falhar no meio, sobra índice INVALID: DROP INDEX CONCURRENTLY e repita.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_messages_org ON public.whatsapp_messages USING btree (organization_id);
