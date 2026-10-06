-- rollback/20271108000100_whatsapp_messages_media_file_name.sql
--
-- ORDEM: reverter o FRONTEND PRIMEIRO, depois este rollback. O chat projeta
-- `media_file_name`; sem a coluna o PostgREST devolve 400 e a thread fica vazia.
-- O DROP COLUMN perde os nomes de documentos cujo raw_payload já foi apagado
-- pela retenção de 14 dias (não há de onde recuperá-los).
-- Se o script de backfill estiver rodando, interrompa-o antes.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS trg_whatsapp_messages_set_media_file_name ON public.whatsapp_messages;
DROP FUNCTION IF EXISTS public.whatsapp_messages_set_media_file_name();
DROP FUNCTION IF EXISTS public.whatsapp_messages_extract_media_file_name(jsonb);
DROP FUNCTION IF EXISTS public.whatsapp_messages_clean_file_name(text);
-- DROP COLUMN é só catálogo (sem rewrite).
ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS media_file_name;

COMMIT;
