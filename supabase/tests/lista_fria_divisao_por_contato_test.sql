-- supabase/tests/lista_fria_divisao_por_contato_test.sql
--
-- Lista Fria · divisão dos contatos por tipo e seleção "E" (migration 20271223000000_lista_fria_divisao_por_contato.sql).
-- A LÓGICA (contagens, combinação, seleção exata, permissões) é do teste de integração
-- tests/integration/lista-fria-divisao.test.mjs, num Postgres real (PGlite). Aqui fica o que só o banco real
-- prova: as permissões das duas funções.
--
--   (AC) ACL: o usuário autenticado executa; anon não

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean)', 'EXECUTE'),
  'AC1: o usuário autenticado executa a divisão (quem barra é a permissão dentro dela)');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean)', 'EXECUTE'),
  'AC2: anon não executa a divisão');
SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean)', 'EXECUTE'),
  'AC3: o usuário autenticado executa a seleção por contato');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean)', 'EXECUTE'),
  'AC4: anon não executa a seleção por contato');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean)'::regprocedure),
  'AC5: a divisão é SECURITY DEFINER (a permissão e a org vêm da busca, dentro dela)');
SELECT ok((SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc WHERE oid = 'public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean)'::regprocedure),
  'AC6: a seleção fixa o search_path');

SELECT * FROM finish();
ROLLBACK;
