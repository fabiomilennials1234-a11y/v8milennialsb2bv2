-- Rollback de 20280123000400_idx_wa_msgs_org_phone_ts_id.sql (fora de transação).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_wa_msgs_org_phone_ts_id;
