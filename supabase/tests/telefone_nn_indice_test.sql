-- supabase/tests/telefone_nn_indice_test.sql
--
-- Telefone N:N, PR3 (Chamado 99067f13; migrations
-- 20271130000000_leads_phone_unique_nao_compartilhado_indice.sql e
-- 20271130000010_leads_phone_unique_troca_e_api_create_lead.sql).
--
--   (IX) o indice final se chama idx_leads_org_phone_unique (o front detecta o 23505
--        por esse nome), e valido, com o predicado novo; nao sobra _v2.
--   (UQ) 2 leads vivos, mesmo numero, ambos phone_compartilhado = false -> 23505 com
--        o nome do indice na mensagem.
--   (CO) dono (false) + lead compartilhado (true) com o mesmo numero COEXISTEM; dois
--        compartilhados tambem; lead apagado nao conflita.
--   (AP) api_create_lead: numero novo cria; numero de dono devolve 'conflict' sem
--        42P10 e sem criar linha; numero que so tem compartilhados CRIA novo
--        (comportamento conhecido, documentado na migration).
--
-- Roda inteiro em transacao revertida. Nao cobre o rollback nem o estado anterior
-- a troca (sao scripts de operacao, nao ha como rodar na mesma transacao).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- (IX) estrutura
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM pg_index i
           WHERE i.indexrelid = to_regclass('public.idx_leads_org_phone_unique')
             AND i.indisvalid AND i.indisunique),
  '(IX) idx_leads_org_phone_unique existe, e UNIQUE e VALIDO');

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_leads_org_phone_unique'))
    ~ 'phone_compartilhado',
  '(IX) o predicado do indice exclui os leads compartilhados');

SELECT ok(
  (SELECT pg_get_expr(i.indpred, i.indrelid) FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_leads_org_phone_unique'))
    ~ 'deleted_at IS NULL',
  '(IX) o predicado continua excluindo lead apagado');

SELECT is(
  to_regclass('public.idx_leads_org_phone_unique_v2')::text, NULL,
  '(IX) nao sobra idx_leads_org_phone_unique_v2');

SELECT ok(
  pg_get_functiondef('public.api_create_lead(uuid,jsonb,text)'::regprocedure)
    ~ 'deleted_at IS NULL AND NOT phone_compartilhado',
  '(IX) api_create_lead infere o indice novo (predicado do ON CONFLICT)');

-- ===========================================================================
-- Fixtures (triggers OFF no seed; normalized_phone explicito)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-0000000000f1', 'Org Idx A', 'org-idx-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-0000000000f2', 'Org Idx B', 'org-idx-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, phone_compartilhado, deleted_at) VALUES
  -- numero A: dono + 2 compartilhados
  ('deadbeef-0000-4000-8000-00000000a001', 'deadbeef-0000-4000-8000-0000000000f1', 'Dono A',   '11911110001', public.normalize_brazilian_phone('11911110001'), false, NULL),
  ('deadbeef-0000-4000-8000-00000000a002', 'deadbeef-0000-4000-8000-0000000000f1', 'Compart 1','11911110001', public.normalize_brazilian_phone('11911110001'), true,  NULL),
  ('deadbeef-0000-4000-8000-00000000a003', 'deadbeef-0000-4000-8000-0000000000f1', 'Compart 2','11911110001', public.normalize_brazilian_phone('11911110001'), true,  NULL),
  -- numero S: so compartilhados (sem dono)
  ('deadbeef-0000-4000-8000-00000000b001', 'deadbeef-0000-4000-8000-0000000000f1', 'So comp 1','11911110002', public.normalize_brazilian_phone('11911110002'), true,  NULL),
  ('deadbeef-0000-4000-8000-00000000b002', 'deadbeef-0000-4000-8000-0000000000f1', 'So comp 2','11911110002', public.normalize_brazilian_phone('11911110002'), true,  NULL),
  -- numero D: lead apagado
  ('deadbeef-0000-4000-8000-00000000c001', 'deadbeef-0000-4000-8000-0000000000f1', 'Apagado',  '11911110003', public.normalize_brazilian_phone('11911110003'), false, now()),
  -- numero E: lead apagado, usado so pela api_create_lead
  ('deadbeef-0000-4000-8000-00000000c002', 'deadbeef-0000-4000-8000-0000000000f1', 'Apagado 2','11911110005', public.normalize_brazilian_phone('11911110005'), false, now()),
  -- numero Q: dono unico (para o 23505 entre nao compartilhados)
  ('deadbeef-0000-4000-8000-00000000d001', 'deadbeef-0000-4000-8000-0000000000f1', 'Dono Q',   '11911110004', public.normalize_brazilian_phone('11911110004'), false, NULL);

-- ===========================================================================
-- (UQ) dois nao compartilhados -> 23505 pelo indice, com o nome
-- ===========================================================================
SELECT throws_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, normalized_phone, phone_compartilhado)
    VALUES ('deadbeef-0000-4000-8000-0000000000f1', 'Dup Q', '11911110004',
            public.normalize_brazilian_phone('11911110004'), false)$$,
  '23505',
  'duplicate key value violates unique constraint "idx_leads_org_phone_unique"',
  '(UQ) 2 leads vivos, mesmo numero, ambos NAO compartilhados -> 23505 em idx_leads_org_phone_unique');

-- dono ja existe; um novo NAO compartilhado no numero A tambem e recusado
SELECT throws_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, normalized_phone, phone_compartilhado)
    VALUES ('deadbeef-0000-4000-8000-0000000000f1', 'Dup A', '11911110001',
            public.normalize_brazilian_phone('11911110001'), false)$$,
  '23505',
  'duplicate key value violates unique constraint "idx_leads_org_phone_unique"',
  '(UQ) segundo dono no numero que ja tem dono -> 23505 mesmo havendo compartilhados');

-- ===========================================================================
-- (CO) coexistencia
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.leads
    WHERE organization_id = 'deadbeef-0000-4000-8000-0000000000f1'
      AND normalized_phone = public.normalize_brazilian_phone('11911110001')
      AND deleted_at IS NULL),
  3::bigint,
  '(CO) dono + 2 compartilhados no mesmo numero coexistem');

SELECT is(
  (SELECT count(*) FROM public.leads
    WHERE organization_id = 'deadbeef-0000-4000-8000-0000000000f1'
      AND normalized_phone = public.normalize_brazilian_phone('11911110002')),
  2::bigint,
  '(CO) dois compartilhados sem dono coexistem');

SELECT lives_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, normalized_phone, phone_compartilhado)
    VALUES ('deadbeef-0000-4000-8000-0000000000f1', 'Novo comp', '11911110004',
            public.normalize_brazilian_phone('11911110004'), true)$$,
  '(CO) marcar compartilhado no numero de um dono existente e aceito pelo indice');

SELECT lives_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, normalized_phone, phone_compartilhado)
    VALUES ('deadbeef-0000-4000-8000-0000000000f1', 'Vivo apos apagado', '11911110003',
            public.normalize_brazilian_phone('11911110003'), false)$$,
  '(CO) lead apagado nao conflita com um novo no mesmo numero');

SELECT lives_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, normalized_phone, phone_compartilhado)
    VALUES ('deadbeef-0000-4000-8000-0000000000f2', 'Outra org', '11911110001',
            public.normalize_brazilian_phone('11911110001'), false)$$,
  '(CO) a unicidade e por organizacao');

-- ===========================================================================
-- (AP) api_create_lead (triggers ON: o gatilho normaliza o telefone)
-- ===========================================================================
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE ap_novo AS
SELECT public.api_create_lead('deadbeef-0000-4000-8000-0000000000f1',
  '{"name":"Numero Novo","phone":"11911119999"}'::jsonb, NULL) AS j;

SELECT is((SELECT j->>'status' FROM ap_novo), 'created', '(AP) numero novo cria');

CREATE TEMP TABLE ap_dono AS
SELECT public.api_create_lead('deadbeef-0000-4000-8000-0000000000f1',
  '{"name":"Tentativa","phone":"11911110004"}'::jsonb, NULL) AS j;

SELECT is((SELECT j->>'status' FROM ap_dono), 'conflict',
  '(AP) numero de dono existente devolve conflict, sem 42P10');

SELECT is(
  (SELECT count(*) FROM public.leads
    WHERE organization_id = 'deadbeef-0000-4000-8000-0000000000f1'
      AND normalized_phone = public.normalize_brazilian_phone('11911110004')
      AND deleted_at IS NULL AND NOT phone_compartilhado),
  1::bigint,
  '(AP) o conflito nao criou um segundo dono');

SELECT is((SELECT j->'lead'->>'name' FROM ap_dono) IN ('Dono Q', 'Novo comp'), true,
  '(AP) conflict devolve um lead que ja estava la (lookup LIMIT 1: pode ser o compartilhado)');

CREATE TEMP TABLE ap_sem_dono AS
SELECT public.api_create_lead('deadbeef-0000-4000-8000-0000000000f1',
  '{"name":"Criado sem dono","phone":"11911110002"}'::jsonb, NULL) AS j;

SELECT is((SELECT j->>'status' FROM ap_sem_dono), 'created',
  '(AP) COMPORTAMENTO CONHECIDO: numero que so tem compartilhados cria um novo lead');

CREATE TEMP TABLE ap_apagado AS
SELECT public.api_create_lead('deadbeef-0000-4000-8000-0000000000f1',
  '{"name":"Apos apagado","phone":"11911110005"}'::jsonb, NULL) AS j;

SELECT is((SELECT j->>'status' FROM ap_apagado), 'created',
  '(AP) numero que so tem lead apagado cria');

SELECT * FROM finish();
ROLLBACK;
