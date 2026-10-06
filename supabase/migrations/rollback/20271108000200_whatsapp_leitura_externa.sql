-- Rollback of 20271108000200_whatsapp_leitura_externa.sql (Chamado 6ebb4b73).
-- Removes the RPC only. last_read_at already advanced by it is NOT reverted (no audit trail of prior values).
DROP FUNCTION IF EXISTS public.apply_external_conversation_read(uuid, uuid, text[]);
