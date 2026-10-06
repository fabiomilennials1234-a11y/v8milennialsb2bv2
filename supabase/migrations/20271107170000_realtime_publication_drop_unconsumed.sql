-- 20271107170000_realtime_publication_drop_unconsumed.sql
--
-- Perf S0 (realtime): tira da publication `supabase_realtime` as 5 tabelas que
-- NINGUÉM assina. Medido em 2026-10-06 (prod jsjsmuncfkbsbzqzqhfq, só leitura):
--   - `realtime.subscription`: 0 assinaturas em qualquer uma das 5;
--   - repo: nenhum `postgres_changes`/`useRealtimeSubscription`/`useRealtimeChannel`
--     nelas em src/, classic/src/ nem supabase/functions/;
--   - escrita desde o reset de stats (05/10 15:55 UTC): order_events 51 INSERTs,
--     as outras 4 zero.
-- Ganho: o Realtime deixa de decodificar o WAL dessas tabelas (pequeno hoje,
-- order_events cresce com pedidos) e a publication passa a dizer a verdade —
-- "está na publication" = "alguém consome". Sem efeito em dado, RLS ou grants.
--
-- Idempotente: só remove o que ainda está na publication.
-- Rollback: rollback/20271107170000_realtime_publication_drop_unconsumed.sql

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
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;

COMMIT;
