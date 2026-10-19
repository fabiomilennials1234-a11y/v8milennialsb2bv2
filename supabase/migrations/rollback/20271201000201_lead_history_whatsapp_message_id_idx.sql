-- rollback/20271201000201_lead_history_whatsapp_message_id_idx.sql
-- Remove o índice. A idempotência de fn_whatsapp_message_to_history volta a
-- varrer o histórico do lead (comportamento idêntico, só mais lento).
-- CONCURRENTLY: psql autocommit, pooler session 5432.

DROP INDEX CONCURRENTLY IF EXISTS public.lead_history_whatsapp_message_id_idx;
