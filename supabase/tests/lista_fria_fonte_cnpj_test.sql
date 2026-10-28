-- supabase/tests/lista_fria_fonte_cnpj_test.sql
--
-- Lista Fria · fonte CNPJ (migration 20271218000000_lista_fria_fonte_cnpj.sql).
-- A LÓGICA (validação, normalização, reserva, restrições, rollback) é do teste de integração
-- tests/integration/lista-fria-cnpj.test.mjs, num Postgres real (PGlite). Aqui fica o que só o
-- banco real prova: as permissões da função recriada e a coluna nova atrás da RLS.
--
--   (GR) CREATE OR REPLACE não soltou permissão: usuário executa, anon não
--   (CL) coluna `filtros` e restrições existem; o usuário só LÊ (sem escrita direta)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_busca_criar(uuid, text, jsonb, integer)', 'EXECUTE'),
  'GR1: o usuário autenticado executa lista_fria_busca_criar');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_busca_criar(uuid, text, jsonb, integer)', 'EXECUTE'),
  'GR2: anon não executa lista_fria_busca_criar');
SELECT ok(NOT has_function_privilege('authenticated', 'public.lista_fria_worker_reivindicar(text)', 'EXECUTE'),
  'GR3: o usuário não reivindica busca (só o worker)');
SELECT ok(has_function_privilege('service_role', 'public.lista_fria_worker_reivindicar(text)', 'EXECUTE'),
  'GR4: o worker reivindica');

SELECT has_column('public', 'lista_fria_buscas', 'filtros', 'CL1: a coluna filtros existe');
SELECT ok(NOT has_column_privilege('authenticated', 'public.lista_fria_buscas', 'filtros', 'INSERT'),
  'CL2: o usuário não escreve filtros direto (só pela RPC)');
SELECT ok(NOT has_column_privilege('authenticated', 'public.lista_fria_buscas', 'filtros', 'UPDATE'),
  'CL3: o usuário não altera filtros direto');
SELECT ok(has_column_privilege('authenticated', 'public.lista_fria_buscas', 'filtros', 'SELECT'),
  'CL4: o usuário lê os filtros da própria org (RLS decide o que enxerga)');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
   WHERE conrelid = 'public.lista_fria_buscas'::regclass
     AND conname = 'lista_fria_buscas_fonte_tem_alvo'
     AND pg_get_constraintdef(oid) LIKE '%cnpj%'),
  'CL5: a restrição de alvo conhece a fonte cnpj');

SELECT * FROM finish();
ROLLBACK;
