-- Rollback de 20271108000500_whatsapp_messages_forwarded_from.sql
--
-- ANTES de rodar: volte o frontend para uma versão que não seleciona
-- `forwarded_from_message_id` — sem a coluna o PostgREST devolve 400 e a thread
-- do chat fica vazia em todas as orgs. Perde a evidência dos encaminhamentos
-- já feitos (o rótulo nativo no WhatsApp do cliente continua).

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.whatsapp_messages
  DROP COLUMN IF EXISTS forwarded_from_message_id;

COMMIT;
