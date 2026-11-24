-- ROLLBACK de 20280128000100_cron_avatar_do_contato.sql
-- Desagenda o job por nome e remove o invocador. Rode ANTES do rollback de
-- 20280128000000.
BEGIN;
DO $$
BEGIN
  -- IF aninhado: sem pg_cron, `cron.job` nem pode ser resolvido.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'contact-avatar-sync') THEN
      PERFORM cron.unschedule('contact-avatar-sync');
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.invoke_contact_avatar_sync();
COMMIT;
