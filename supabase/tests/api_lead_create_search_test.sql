-- supabase/tests/api_lead_create_search_test.sql
--
-- Ticket #1768 — `api_create_lead` e `api_search_leads`, o guardião do registro
-- por trás de POST /leads e GET /leads/search.
--
-- O que esta suíte prova, e o handler não pode provar: as decisões que só o
-- banco toma. A suíte de rota (Deno, dublê) cobre o CONTRATO — 409 com id e
-- nome, 200 no replay. Aqui embaixo é o COMPORTAMENTO: quantas linhas
-- realmente existem depois, e o que a segunda chamada devolve.
--
-- ⚠️ O QUE ESTA SUÍTE NÃO PROVA: atomicidade sob concorrência. Duas requisições
-- simultâneas com o mesmo telefone é corrida, e corrida não se prova numa
-- transação sequencial. A atomicidade vem do `ON CONFLICT DO NOTHING` sobre
-- `idx_leads_org_phone_unique`, e o que esta suíte garante é que o índice existe
-- e que o caminho de conflito devolve o que deve. A corrida em si é teste de
-- integração contra branch efêmera, com duas conexões.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (ACL) a superfície não pode estar aberta
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.api_create_lead(uuid,jsonb,text)', 'EXECUTE'),
  '(ACL) anon NÃO executa api_create_lead');

SELECT ok(
  NOT has_function_privilege('anon', 'public.api_search_leads(uuid,text,text,int)', 'EXECUTE'),
  '(ACL) anon NÃO executa api_search_leads');

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('api_create_lead','api_search_leads')),
  2::bigint,
  '(ACL) uma assinatura de cada — overload faria o PostgREST resolver a errada');

-- ===========================================================================
-- (STRUCT) o índice de onde vem a atomicidade
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = 'idx_leads_org_phone_unique'),
  '(STRUCT) idx_leads_org_phone_unique existe — é dele que vem o ON CONFLICT');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = 'uq_api_idempotency'),
  '(STRUCT) uq_api_idempotency existe — resolve a corrida na própria chave');

-- ===========================================================================
-- Fixtures: DUAS organizações, porque isolamento é asserção, não esperança
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-0000000000e1', 'Org API A', 'org-api-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-0000000000e2', 'Org API B', 'org-api-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (CRIAR) primeira chamada cria
-- ===========================================================================
CREATE TEMP TABLE r1 AS
SELECT public.api_create_lead(
  'deadbeef-0000-4000-8000-0000000000e1',
  '{"name":"João Teste","phone":"11955554444","email":"joao@acme.com"}'::jsonb,
  'chave-1') AS j;

SELECT is((SELECT j->>'status' FROM r1), 'created', '(CRIAR) primeira chamada devolve created');
SELECT ok((SELECT j->'lead'->>'id' FROM r1) IS NOT NULL, '(CRIAR) devolve o id do Lead criado');

-- ===========================================================================
-- (CONFLITO) telefone repetido NÃO cria segunda pessoa
-- ===========================================================================
CREATE TEMP TABLE r2 AS
SELECT public.api_create_lead(
  'deadbeef-0000-4000-8000-0000000000e1',
  '{"name":"João Outro","phone":"11955554444"}'::jsonb,
  NULL) AS j;

SELECT is((SELECT j->>'status' FROM r2), 'conflict', '(CONFLITO) telefone repetido devolve conflict');

-- A asserção que importa: quantas linhas existem de verdade. Status "conflict"
-- com duas linhas na base seria mentira educada.
SELECT is(
  (SELECT count(*) FROM public.leads
    WHERE organization_id = 'deadbeef-0000-4000-8000-0000000000e1'
      AND normalized_phone = public.normalize_brazilian_phone('11955554444')
      AND deleted_at IS NULL),
  1::bigint,
  '(CONFLITO) existe UMA linha — a segunda chamada não criou nada');

SELECT is(
  (SELECT j->'lead'->>'name' FROM r2), 'João Teste',
  '(CONFLITO) devolve o nome de QUEM JÁ ESTÁ LÁ, não o nome que veio na chamada');

SELECT is(
  (SELECT j->'lead'->>'id' FROM r2), (SELECT j->'lead'->>'id' FROM r1),
  '(CONFLITO) o id devolvido é o do Lead existente — é o que o chamador usa para seguir');

-- ===========================================================================
-- (IDEMPOTÊNCIA) mesma chave devolve o mesmo; chave nova cria
-- ===========================================================================
CREATE TEMP TABLE r3 AS
SELECT public.api_create_lead(
  'deadbeef-0000-4000-8000-0000000000e1',
  '{"name":"João Teste","phone":"11955554444"}'::jsonb,
  'chave-1') AS j;

SELECT is((SELECT j->>'status' FROM r3), 'replayed', '(IDEMPOTÊNCIA) mesma chave devolve replayed');
SELECT is(
  (SELECT j->'lead'->>'id' FROM r3), (SELECT j->'lead'->>'id' FROM r1),
  '(IDEMPOTÊNCIA) replay devolve o MESMO Lead da primeira chamada');

-- CONTROLE POSITIVO: sem isto, uma implementação que devolvesse "replayed" para
-- tudo passaria em todas as asserções acima.
CREATE TEMP TABLE r4 AS
SELECT public.api_create_lead(
  'deadbeef-0000-4000-8000-0000000000e1',
  '{"name":"Maria","phone":"11933332222"}'::jsonb,
  'chave-2') AS j;

SELECT is((SELECT j->>'status' FROM r4), 'created',
  '(CONTROLE) chave diferente e telefone diferente CRIAM — replay não é resposta universal');

-- ===========================================================================
-- (TENANT) a chave e o telefone não atravessam organização
-- ===========================================================================
CREATE TEMP TABLE r5 AS
SELECT public.api_create_lead(
  'deadbeef-0000-4000-8000-0000000000e2',
  '{"name":"João da Org B","phone":"11955554444"}'::jsonb,
  'chave-1') AS j;

SELECT is((SELECT j->>'status' FROM r5), 'created',
  '(TENANT) mesmo telefone e mesma chave, em OUTRA org, criam — nada vaza entre inquilinos');

SELECT isnt(
  (SELECT j->'lead'->>'id' FROM r5), (SELECT j->'lead'->>'id' FROM r1),
  '(TENANT) é um Lead diferente, não o da org A');

-- ===========================================================================
-- (BUSCA)
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.api_search_leads(
     'deadbeef-0000-4000-8000-0000000000e1', '11955554444', NULL, 50)),
  1::bigint,
  '(BUSCA) por telefone acha o Lead da org');

SELECT is(
  (SELECT count(*) FROM public.api_search_leads(
     'deadbeef-0000-4000-8000-0000000000e1', NULL, 'JOAO@ACME.COM', 50)),
  1::bigint,
  '(BUSCA) por e-mail é insensível a caixa — quem integra manda como o cliente digitou');

SELECT is(
  (SELECT count(*) FROM public.api_search_leads(
     'deadbeef-0000-4000-8000-0000000000e1', '11900000000', NULL, 50)),
  0::bigint,
  '(BUSCA) telefone que não existe devolve vazio, não a base inteira');

-- O Lead da org B tem o MESMO telefone. A busca da org A não pode enxergá-lo.
SELECT is(
  (SELECT count(*) FROM public.api_search_leads(
     'deadbeef-0000-4000-8000-0000000000e2', '11955554444', NULL, 50)),
  1::bigint,
  '(TENANT) a busca da org B acha só o dela — mesmo telefone, inquilino diferente');

ROLLBACK;
