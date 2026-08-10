-- supabase/tests/whatsapp_instance_reap_queue_test.sql
--
-- ISSUE #1475 (PRD #1472) — lápide de Instance WhatsApp.
--
-- Run:
--   supabase test db
-- ou direto num stack local:
--   psql "$DATABASE_URL" -f supabase/tests/whatsapp_instance_reap_queue_test.sql
--
-- O que prova:
--   (a) estrutura: tabela, RLS habilitada, ZERO policies (deny-all)
--   (b) anon e authenticated não têm privilégio algum na tabela
--   (c) a função DEFINER do trigger não é executável por anon/PUBLIC e fixa
--       search_path
--   (d) delete direto de Instance grava lápide COM o token preservado
--   (e) delete de ORGANIZATION grava lápide para CADA Instance dela — o caminho
--       que nenhum código de aplicação alcança, e o motivo de a lápide existir
--   (f) a lápide SOBREVIVE à remoção da org (sem FK, de propósito)
--   (g) Instance sem credencial gera lápide pendente — a desistência é decisão
--       do coletor, não do trigger
--   (h) ORDEM INVERSA: o segredo morrendo antes da Instance já grava o token, e
--       a Instance depois completa os metadados sem duplicar nem sobrescrever.
--       Este caso reprovou a primeira versão do desenho — no CASCADE de org o
--       Postgres não garante a ordem entre as duas tabelas.
--
-- Nota sobre roles: as asserções de privilégio usam has_table_privilege /
-- has_function_privilege contra os roles reais. Não basta rodar como postgres —
-- postgres tem BYPASSRLS e daria falso verde.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'whatsapp_instance_reap_queue',
  '(a) tabela whatsapp_instance_reap_queue existe');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.whatsapp_instance_reap_queue'::regclass),
  '(a) RLS está ENABLED na lápide');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_instance_reap_queue'),
  0,
  '(a) lápide tem ZERO policies — deny-all, ninguém lê token via PostgREST');

-- A ausência de FK é o coração do desenho: com FK para organizations, o CASCADE
-- apagaria a lápide junto e reabriria o vazamento que ela existe para tapar.
SELECT is(
  (SELECT count(*)::int
     FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'whatsapp_instance_reap_queue'
      AND constraint_type = 'FOREIGN KEY'),
  0,
  '(a) lápide NÃO tem FK — precisa sobreviver ao delete da org e da Instance');

-- ---------------------------------------------------------------------------
-- (b) Privilégios de tabela
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_table_privilege('anon', 'public.whatsapp_instance_reap_queue', 'SELECT'),
  '(b) anon NÃO tem SELECT na lápide');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.whatsapp_instance_reap_queue', 'SELECT'),
  '(b) authenticated NÃO tem SELECT na lápide');

SELECT ok(
  has_table_privilege('service_role', 'public.whatsapp_instance_reap_queue', 'SELECT'),
  '(b) service_role TEM SELECT — é quem o coletor usa');

-- ---------------------------------------------------------------------------
-- (c) Função DEFINER do trigger
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'enqueue_whatsapp_instance_reap',
  '(c) função de trigger do lado da Instance existe');

SELECT has_function('public', 'enqueue_whatsapp_secret_reap',
  '(c) função de trigger do lado do segredo existe');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.enqueue_whatsapp_secret_reap()', 'EXECUTE'),
  '(c) anon NÃO pode executar a função DEFINER do lado do segredo');

SELECT ok(
  NOT has_function_privilege('anon',
    'public.enqueue_whatsapp_instance_reap()', 'EXECUTE'),
  '(c) anon NÃO pode executar a função DEFINER de escrita');

SELECT ok(
  (SELECT p.proconfig::text LIKE '%search_path=%'
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enqueue_whatsapp_instance_reap'),
  '(c) função DEFINER fixa search_path');

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- whatsapp_instances tem trg_enforce_whatsapp_instance_limit BEFORE INSERT, que
-- chama assert_org_access e nega sem contexto de JWT. Mesmo recurso das suítes
-- de voip: planta a fixture com os triggers desligados e RELIGA antes dos
-- deletes — que é justamente o que este teste precisa observar.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Reap Org A', 'reap-org-a'),
       ('aaaaaaaa-0000-4000-8000-000000000002', 'Reap Org B', 'reap-org-b');

-- Org A: uma Instance COM credencial → delete direto
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, instance_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'reap-direct', 'uazapi', 'prov-inst-1');

INSERT INTO public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token, uazapi_instance_id)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'tok-preservado-1', 'prov-inst-1');

-- Org B: DUAS Instances com credencial → delete da org (CASCADE)
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider)
VALUES ('bbbbbbbb-0000-4000-8000-000000000011',
        'aaaaaaaa-0000-4000-8000-000000000002', 'reap-cascade-1', 'uazapi'),
       ('bbbbbbbb-0000-4000-8000-000000000012',
        'aaaaaaaa-0000-4000-8000-000000000002', 'reap-cascade-2', 'uazapi');

INSERT INTO public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token)
VALUES ('bbbbbbbb-0000-4000-8000-000000000011',
        'aaaaaaaa-0000-4000-8000-000000000002', 'tok-cascade-1'),
       ('bbbbbbbb-0000-4000-8000-000000000012',
        'aaaaaaaa-0000-4000-8000-000000000002', 'tok-cascade-2');

-- Org A: uma Instance SEM credencial (órfã de createInstance que falhou)
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider)
VALUES ('bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001', 'reap-sem-token', 'uazapi');

-- Triggers de volta: daqui pra baixo é o comportamento sob teste.
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (d) Delete direto preserva o token
-- ---------------------------------------------------------------------------
DELETE FROM public.whatsapp_instances
 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  1,
  '(d) delete direto de Instance grava exatamente uma lápide');

SELECT is(
  (SELECT provider_token FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  'tok-preservado-1',
  '(d) token foi capturado ANTES do CASCADE apagar o segredo');

SELECT ok(
  (SELECT gave_up_at IS NULL AND confirmed_at IS NULL
     FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '(d) lápide com credencial nasce pendente, para o coletor pegar');

-- ---------------------------------------------------------------------------
-- (g) Sem credencial → lápide pendente; quem desiste é o coletor
-- ---------------------------------------------------------------------------
DELETE FROM public.whatsapp_instances
 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- A desistência NÃO acontece aqui: um trigger não pode concluir "não há
-- credencial", porque ela pode chegar no upsert seguinte (ver seção 3 da
-- migration). Quem decide é o coletor. O que a lápide garante é o registro.
SELECT ok(
  (SELECT provider_token IS NULL AND gave_up_at IS NULL
     FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  '(g) Instance sem credencial gera lápide sem token, pendente para o coletor decidir');

-- ---------------------------------------------------------------------------
-- (e) + (f) CASCADE de organização — o caminho que nenhum código alcança
-- ---------------------------------------------------------------------------
DELETE FROM public.organizations
 WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM public.whatsapp_instance_reap_queue
    WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  2,
  '(e) apagar a ORG grava uma lápide para CADA Instance dela');

SELECT is(
  (SELECT count(*)::int FROM public.whatsapp_instance_reap_queue
    WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000002'
      AND provider_token IS NOT NULL),
  2,
  '(f) lápides sobrevivem ao delete da org COM os tokens — sem FK, sem CASCADE');

-- ---------------------------------------------------------------------------
-- (h) Ordem inversa — segredo morre ANTES da Instance
--
-- Este é o caso que reprovou a primeira versão do desenho. No CASCADE de org o
-- Postgres não garante a ordem, e medimos o segredo morrendo primeiro: o trigger
-- da Instance não achava o token e a lápide nascia inútil. Com upsert nos dois
-- lados, a ordem deixa de importar.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-8000-000000000003', 'Reap Org C', 'reap-org-c');

INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider)
VALUES ('bbbbbbbb-0000-4000-8000-000000000021',
        'aaaaaaaa-0000-4000-8000-000000000003', 'reap-ordem-inversa', 'uazapi');

INSERT INTO public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token)
VALUES ('bbbbbbbb-0000-4000-8000-000000000021',
        'aaaaaaaa-0000-4000-8000-000000000003', 'tok-ordem-inversa');

SET LOCAL session_replication_role = origin;

DELETE FROM public.whatsapp_instance_secrets
 WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000021';

SELECT is(
  (SELECT provider_token FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000021'),
  'tok-ordem-inversa',
  '(h) segredo morrendo primeiro já grava a lápide com o token');

DELETE FROM public.whatsapp_instances
 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000021';

SELECT is(
  (SELECT count(*)::int FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000021'),
  1,
  '(h) a Instance morrendo depois NÃO duplica a lápide — upsert por instance_id');

SELECT is(
  (SELECT instance_name || '|' || provider_token
     FROM public.whatsapp_instance_reap_queue
    WHERE instance_id = 'bbbbbbbb-0000-4000-8000-000000000021'),
  'reap-ordem-inversa|tok-ordem-inversa',
  '(h) o segundo trigger COMPLETA os metadados sem sobrescrever o token');

SELECT * FROM finish();

ROLLBACK;
