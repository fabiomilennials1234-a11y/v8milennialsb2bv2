-- ROLLBACK de 20280128000000_avatar_do_contato_whatsapp.sql
-- Rode DEPOIS do rollback de 20280128000100 (o cron chama a edge fn que usa
-- estas RPCs). Recusa enquanto houver arquivo no bucket: esvazie-o antes pela
-- API do Storage (o banco não apaga objeto) — as fotos são cópia do WhatsApp,
-- nada de cliente se perde, mas arquivo sem linha seria lixo com PII.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'contact-avatars') THEN
    RAISE EXCEPTION 'Rollback recusado: bucket contact-avatars tem objetos. Esvazie pela API do Storage antes.';
  END IF;
END $$;

DROP FUNCTION public.avatares_das_conversas(uuid, text[]);
DROP FUNCTION public.podar_avatares_orfaos(integer);
DROP FUNCTION public.reivindicar_avatares(integer, uuid[]);
DROP FUNCTION public.registrar_avatar_candidato(uuid, uuid, text, text);

DROP POLICY contact_avatars_select ON storage.objects;
DROP FUNCTION private.contact_avatar_object_readable(text);
DELETE FROM storage.buckets WHERE id = 'contact-avatars';

DROP TABLE public.whatsapp_contact_avatars;
DROP FUNCTION public.enfileirar_remocao_avatar();
DROP TABLE public.contact_avatar_storage_deletions;
DELETE FROM public.cron_config WHERE key = 'contact_avatar_orphan_cursor';

COMMIT;
