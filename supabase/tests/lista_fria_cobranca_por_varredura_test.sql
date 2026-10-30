-- supabase/tests/lista_fria_cobranca_por_varredura_test.sql
--
-- Lista Fria · crédito Meta cobrado por seguidor varrido (migration 20271221000000_lista_fria_cobranca_por_varredura.sql,
-- ADR-0046). A LÓGICA (reserva fixa, débito monotônico, teto, devolução de metade, rollback) é do teste de
-- integração tests/integration/lista-fria-varredura.test.mjs, num Postgres real (PGlite). Aqui fica o que só o
-- banco real prova: permissões e a tabela de custo que o cliente não alcança.
--
--   (AC) ACL: só o serviço chama a varredura; o usuário nunca se cobra
--   (CU) o custo real (a margem da casa) não é legível pelo cliente
--   (CL) colunas e restrições novas de lista_fria_buscas

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SELECT ok(has_function_privilege('service_role', 'public.lista_fria_worker_varrer(uuid, text, integer, numeric)', 'EXECUTE'),
  'AC1: o worker (service_role) executa a varredura');
SELECT ok(NOT has_function_privilege('authenticated', 'public.lista_fria_worker_varrer(uuid, text, integer, numeric)', 'EXECUTE'),
  'AC2: o usuário autenticado NÃO executa a varredura (não se cobra menos)');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_worker_varrer(uuid, text, integer, numeric)', 'EXECUTE'),
  'AC3: anon não executa a varredura');

SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_busca_custos', 'SELECT'),
  'CU1: o usuário não lê o custo real das buscas');
SELECT ok(NOT has_table_privilege('anon', 'public.lista_fria_busca_custos', 'SELECT'),
  'CU2: anon não lê o custo real das buscas');
SELECT ok(has_table_privilege('service_role', 'public.lista_fria_busca_custos', 'INSERT'),
  'CU3: o serviço grava o custo');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lista_fria_busca_custos'::regclass),
  'CU4: a tabela de custo tem RLS ligada');

SELECT has_column('public', 'lista_fria_buscas', 'cobranca', 'CL1: modo de cobrança');
SELECT has_column('public', 'lista_fria_buscas', 'varridos', 'CL2: seguidores varridos');
SELECT has_column('public', 'lista_fria_buscas', 'contatos_novos', 'CL3: contatos novos entregues');
SELECT has_column('public', 'lista_fria_buscas', 'seguidores_por_credito', 'CL4: seguidores por crédito (preço no momento da criação)');
SELECT hasnt_column('public', 'lista_fria_buscas', 'custo_usd', 'CL5: o custo NÃO está na tabela que o cliente lê com select *');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.lista_fria_buscas'::regclass
                     AND conname = 'lista_fria_buscas_cobranca_valida'),
  'CL6: a restrição por_contato|por_varredura existe');
SELECT col_default_is('public', 'lista_fria_buscas', 'cobranca', 'por_contato',
  'CL7: buscas antigas e as de Maps e CNPJ ficam por contato');

SELECT * FROM finish();
ROLLBACK;
