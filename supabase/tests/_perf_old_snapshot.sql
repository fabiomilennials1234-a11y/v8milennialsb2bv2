-- supabase/tests/_perf_old_snapshot.sql
--
-- Copia os corpos VIGENTES (antes da Trilha B de perf, 20280123*) para o schema
-- `perf_old`, para as suítes de equivalência compararem novo × antigo NO MESMO
-- banco e no mesmo instante:
--   lista_multi_nome_salvo_test.sql, lista_oficial_gates_test.sql
-- Rodar UMA vez, ANTES de aplicar 20280123000600/0700, na branch de ensaio
-- (nunca em prod). Num ensaio transacional contra prod, rodar dentro do mesmo
-- BEGIN…ROLLBACK, antes das migrations.
CREATE SCHEMA IF NOT EXISTS perf_old;
GRANT USAGE ON SCHEMA perf_old TO authenticated;
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname, p.proname) IN (('public','get_whatsapp_conversation_list_multi'),
                                              ('public','get_official_whatsapp_conversation_list_multi'))
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.oid), '^CREATE OR REPLACE FUNCTION ' || r.nspname || '\.', 'CREATE OR REPLACE FUNCTION perf_old.');
  END LOOP;
END $do$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA perf_old TO authenticated;
