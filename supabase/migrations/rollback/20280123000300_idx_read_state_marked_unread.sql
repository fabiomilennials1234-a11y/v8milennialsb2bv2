-- Rollback de 20280123000300_idx_read_state_marked_unread.sql (fora de transação).
DROP INDEX CONCURRENTLY IF EXISTS public.conversation_read_state_marked_unread_idx;
