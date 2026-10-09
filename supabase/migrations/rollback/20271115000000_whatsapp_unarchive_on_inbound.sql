-- Rollback de 20271115000000_whatsapp_unarchive_on_inbound.sql:
-- remove o gatilho e a função. Conversas já desarquivadas continuam
-- desarquivadas (não há como distinguir de um desarquivamento manual).

DROP TRIGGER IF EXISTS trg_unarchive_on_inbound ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS private.unarchive_conversation_on_inbound();
