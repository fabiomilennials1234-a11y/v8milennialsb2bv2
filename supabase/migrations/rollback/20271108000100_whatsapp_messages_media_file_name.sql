-- rollback/20271108000100_whatsapp_messages_media_file_name.sql
--
-- ATENÇÃO: reverter o frontend ANTES deste rollback. O chat projeta
-- `media_file_name`; sem a coluna o PostgREST devolve 400 e a thread fica vazia.
-- O DROP COLUMN perde os nomes de documentos cujo raw_payload já foi apagado
-- pela retenção de 14 dias (não há de onde recuperá-los).

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_whatsapp_messages_set_media_file_name ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS public.whatsapp_messages_set_media_file_name();
DROP FUNCTION IF EXISTS public.whatsapp_messages_extract_media_file_name(jsonb);
ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS media_file_name;

COMMIT;
