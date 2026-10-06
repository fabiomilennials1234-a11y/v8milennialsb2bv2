-- rollback/20271107170000_realtime_publication_drop_unconsumed.sql
--
-- Devolve as 5 tabelas à publication `supabase_realtime` (estado de prod lido
-- em 2026-10-06 antes do apply). Idempotente: só adiciona o que falta.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'acoes_do_dia',
    'badges',
    'client_sidebar_permissions',
    'feature_permissions',
    'order_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;

COMMIT;
