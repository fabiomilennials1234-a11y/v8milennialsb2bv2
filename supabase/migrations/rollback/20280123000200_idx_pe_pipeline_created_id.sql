-- Rollback de 20280123000200_idx_pe_pipeline_created_id.sql (fora de transação).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pe_pipeline_created_id;
