-- supabase/tests/lista_fria_creditos_meta_test.sql
--
-- Lista Fria · dois saldos de crédito (migration 20271220000000_lista_fria_creditos_meta.sql, ADR-0044).
-- A LÓGICA (saldo por tipo, reserva, devolução, rollback) é do teste de integração
-- tests/integration/lista-fria-creditos-meta.test.mjs, num Postgres real (PGlite). Aqui fica o que só o
-- banco real prova: as permissões das funções novas e da recriada.
--
--   (AC) ACL: o usuário lê os saldos e anon não; a função interna não é chamável pelo usuário
--   (CL) coluna `tipo` e restrição; a assinatura antiga da concessão não existe mais

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_saldos(uuid)', 'EXECUTE'),
  'AC1: o usuário autenticado executa lista_fria_saldos');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_saldos(uuid)', 'EXECUTE'),
  'AC2: anon não executa lista_fria_saldos');
SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_creditos_conceder(uuid, integer, text, text)', 'EXECUTE'),
  'AC3: a concessão de 4 argumentos é executável (quem barra é o is_master_user dentro dela)');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_creditos_conceder(uuid, integer, text, text)', 'EXECUTE'),
  'AC4: anon não concede crédito');
SELECT ok(NOT has_function_privilege('authenticated', 'private.lista_fria_saldo_da_org(uuid, text)', 'EXECUTE'),
  'AC5: o saldo interno por tipo não é chamável pelo usuário');
SELECT ok(NOT has_function_privilege('authenticated', 'private.lista_fria_tipo_da_fonte(text)', 'EXECUTE'),
  'AC6: o mapa fonte -> tipo é interno');
SELECT ok(has_function_privilege('authenticated', 'public.lista_fria_saldo(uuid)', 'EXECUTE'),
  'AC7: a RPC de saldo antiga segue executável (o front publicado depende dela)');

SELECT has_column('public', 'lista_fria_creditos', 'tipo', 'CL1: o livro tem a coluna tipo');
SELECT ok(NOT has_column_privilege('authenticated', 'public.lista_fria_creditos', 'tipo', 'INSERT'),
  'CL2: o usuário não escreve crédito direto (só pelas RPCs)');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.lista_fria_creditos'::regclass
                     AND conname = 'lista_fria_creditos_tipo_check'),
  'CL3: a restrição normal|meta existe');
SELECT ok(to_regprocedure('public.lista_fria_creditos_conceder(uuid, integer, text)') IS NULL,
  'CL4: a assinatura antiga de 3 argumentos saiu (a nova a atende por default)');

SELECT * FROM finish();
ROLLBACK;
