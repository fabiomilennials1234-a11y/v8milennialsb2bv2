-- Rollback de 20280123000900_idx_wa_msgs_incoming_instance_cover.sql (fora de transação).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_wa_msgs_incoming_instance_cover;
