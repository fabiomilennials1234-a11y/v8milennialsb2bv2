-- supabase/tests/productivity_canonical_test.sql
--
-- ISSUE #1000 (PRD #986, ADR-0013 activity-in-period / ADR-0017 §2-5,§8) — pgTAP
-- da PRODUTIVIDADE canônica: a dimensão `vendido` das três RPCs lê SÓ sale_events,
-- líquida de estorno, âncora sold_at, atribuição sale_responsible_id única, SEM
-- type='system' (custom pipelines contam — R3). Mata R3/R4/R5 que a RPC de
-- 2026-07-03 (20270201000000) reintroduziu.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/productivity_canonical_test.sql
--
-- Asserts:
--   (a) assinatura + grants das 3 RPCs
--   (b) vendido líquido de estorno (sale + sale_reversed → some da contagem)
--   (c) vendido atribui SÓ por sale_responsible_id (pre_sale NÃO conta — R5)
--   (d) vendido conta funil custom (sale_event sem pipeline system — R3)
--   (e) novos_leads por created_at; reuniões por meeting_events (ADR-0007)
--   (f) placar by_seller: vendido por sale_responsible_id; membro só-reunião entra
--   (g) drill vendido = linhas do caderno, líquido de estorno
--   (h) assert_org_access rejeita cross-org

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ---------------------------------------------------------------------------
-- (a) Estrutura + grants
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_productivity_activity',
  ARRAY['uuid','timestamptz','timestamptz','uuid'],
  '(a) get_productivity_activity existe com a assinatura nomeada');

SELECT has_function(
  'public', 'get_productivity_activity_leads',
  ARRAY['uuid','timestamptz','timestamptz','text','uuid'],
  '(a) get_productivity_activity_leads existe com a assinatura nomeada');

SELECT has_function(
  'public', 'get_productivity_activity_by_seller',
  ARRAY['uuid','timestamptz','timestamptz'],
  '(a) get_productivity_activity_by_seller existe com a assinatura nomeada');

SELECT ok(
  has_function_privilege('authenticated', 'public.get_productivity_activity(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_productivity_activity_by_seller(uuid,timestamptz,timestamptz)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs (tz America/Sao_Paulo), 2 vendedores, leads, reuniões, vendas.
-- Semeia sale_events/meeting_events DIRETO (teste de LEITOR): triggers OFF +
-- sold_at explícito + source='backfill' pra controlar âncora e período.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('10001000-aaaa-0000-0000-000000001000', 'Org A (#1000)', 'org-a-1000-prod', 'America/Sao_Paulo'),
  ('10001000-bbbb-0000-0000-000000001000', 'Org B (#1000)', 'org-b-1000-prod', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('10001000-aaaa-1111-0000-000000001000', 'user-a-1000@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- seller1 = closer (sales); seller2 = pré-vendas (meetings)
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, metric_type)
VALUES
  ('10001000-aaaa-2222-0000-000000001000', '10001000-aaaa-0000-0000-000000001000',
   '10001000-aaaa-1111-0000-000000001000', 'Seller 1', 'admin', true, 'sales'),
  ('10001000-aaaa-2222-0001-000000001000', '10001000-aaaa-0000-0000-000000001000',
   NULL, 'Seller 2', 'membro', true, 'meetings')
ON CONFLICT (id) DO NOTHING;

-- lead1 criado DENTRO da janela (novos_leads), responsável = seller1;
-- lead_old criado FORA da janela (não conta em novos).
INSERT INTO public.leads (id, organization_id, name, responsible_id, created_at)
VALUES
  ('10001000-aaaa-3333-0001-000000001000', '10001000-aaaa-0000-0000-000000001000', 'Lead 1',
   '10001000-aaaa-2222-0000-000000001000', '2027-07-05 09:00-03'),
  ('10001000-aaaa-3333-0002-000000001000', '10001000-aaaa-0000-0000-000000001000', 'Lead Old',
   '10001000-aaaa-2222-0000-000000001000', '2027-05-01 09:00-03')
ON CONFLICT (id) DO NOTHING;

-- Reuniões (ADR-0007), atribuição = seller2: 1 marcada (occurred_at) + 1 realizada (meeting_date).
INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, pre_sale_responsible_id, occurred_at, meeting_date, source)
VALUES
  ('10001000-aaaa-0000-0000-000000001000','10001000-aaaa-3333-0001-000000001000','meeting_booked',
   '10001000-aaaa-2222-0001-000000001000','2027-07-10 10:00-03', NULL, 'pipeline'),
  ('10001000-aaaa-0000-0000-000000001000','10001000-aaaa-3333-0001-000000001000','meeting_held',
   '10001000-aaaa-2222-0001-000000001000','2027-07-15 10:00-03','2027-07-12 14:00-03', 'pipeline');

-- Vendas no caderno. pipeline_id = uuid ARBITRÁRIO (NÃO existe pipelines row):
-- prova que o novo leitor NÃO depende de type='system' (R3).
--  sv1 seller1 sale 07-10  (NÃO estornada)          → conta
--  sv2 seller1 sale 07-11  (ESTORNADA)               → NÃO conta
--  sv3 sale_responsible=seller1, pre_sale=seller2 07-13 (NÃO estornada) → conta pra seller1, não seller2
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, pre_sale_responsible_id, source)
VALUES
 ('10001000-aaaa-0000-0000-000000001000','10001000-aaaa-3333-0001-000000001000','10001000-cccc-4444-0009-000000001000','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio','10001000-aaaa-2222-0000-000000001000',NULL,'backfill'),
 ('10001000-aaaa-0000-0000-000000001000','10001000-aaaa-3333-0001-000000001000','10001000-cccc-4444-0009-000000001000','vendido','sale','2027-07-11 12:00-03',2000,'novo_negocio','10001000-aaaa-2222-0000-000000001000',NULL,'backfill'),
 ('10001000-aaaa-0000-0000-000000001000','10001000-aaaa-3333-0001-000000001000','10001000-cccc-4444-0009-000000001000','vendido','sale','2027-07-13 12:00-03',300,'novo_negocio','10001000-aaaa-2222-0000-000000001000','10001000-aaaa-2222-0001-000000001000','backfill');

-- Estorno de sv2 (mais tarde no mês) — anula a venda de 2000 do seller1.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
SELECT s.organization_id, s.lead_id, s.pipeline_id, 'esfriou', 'sale_reversed', s.id,
       '2027-07-20 12:00-03', s.sale_value, s.revenue_stream, s.sale_responsible_id, 'backfill'
FROM public.sale_events s
WHERE s.organization_id = '10001000-aaaa-0000-0000-000000001000'
  AND s.event_type = 'sale' AND s.sale_value = 2000;

SET LOCAL session_replication_role = origin;

-- Janela de julho/2027 (bounds passados como a RPC recebe: timestamptz).
-- ---------------------------------------------------------------------------
-- (b) vendido líquido de estorno — org-wide = sv1 + sv3 = 2 (sv2 estornada fora)
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', NULL) ->> 'vendido')::int,
  2, '(b) vendido org-wide líquido de estorno (sv2 estornada não conta)');

-- ---------------------------------------------------------------------------
-- (c) atribuição SÓ por sale_responsible_id — seller1 = 2; seller2 (só pre_sale) = 0
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', '10001000-aaaa-2222-0000-000000001000') ->> 'vendido')::int,
  2, '(c) filtro por seller1 (sale_responsible) = 2');

SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', '10001000-aaaa-2222-0001-000000001000') ->> 'vendido')::int,
  0, '(c) filtro por seller2 (pre_sale de sv3) = 0 — pre_sale NÃO é atribuição de venda (R5)');

-- ---------------------------------------------------------------------------
-- (d) R3: as vendas contadas estão num pipeline_id arbitrário (sem pipelines
--     row, sem type=''system''). O count 2 acima já prova que custom pipeline
--     conta; asserção explícita de que NÃO há dependência do funil system.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.pipelines WHERE id = '10001000-cccc-4444-0009-000000001000')
  AND (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', NULL) ->> 'vendido')::int = 2,
  '(d) vendido conta venda de funil custom (sem pipeline system — R3 morto)');

-- ---------------------------------------------------------------------------
-- (e) novos_leads por created_at (só lead1); reuniões por meeting_events
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', NULL) ->> 'novos_leads')::int,
  1, '(e) novos_leads = 1 (lead1 no período; lead_old de maio fora)');

SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', NULL) ->> 'reunioes_marcadas')::int,
  1, '(e) reunioes_marcadas = 1 (meeting_booked por occurred_at)');

SELECT is(
  (public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03', NULL) ->> 'reunioes_realizadas')::int,
  1, '(e) reunioes_realizadas = 1 (meeting_held por meeting_date)');

-- ---------------------------------------------------------------------------
-- (f) placar by_seller — seller1 vendido=2; seller2 só-reunião entra com vendido=0
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (e->>'vendido')::int
   FROM jsonb_array_elements(public.get_productivity_activity_by_seller(
     '10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03')) e
   WHERE e->>'seller_id' = '10001000-aaaa-2222-0000-000000001000'),
  2, '(f) by_seller seller1 vendido = 2 (sale_responsible_id)');

SELECT is(
  (SELECT (e->>'vendido')::int
   FROM jsonb_array_elements(public.get_productivity_activity_by_seller(
     '10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03')) e
   WHERE e->>'seller_id' = '10001000-aaaa-2222-0001-000000001000'),
  0, '(f) by_seller seller2 (só reuniões) entra com vendido = 0');

SELECT is(
  (SELECT (e->>'reunioes_marcadas')::int
   FROM jsonb_array_elements(public.get_productivity_activity_by_seller(
     '10001000-aaaa-0000-0000-000000001000',
     '2027-07-01 00:00-03','2027-07-31 23:59:59-03')) e
   WHERE e->>'seller_id' = '10001000-aaaa-2222-0001-000000001000'),
  1, '(f) by_seller seller2 reunioes_marcadas = 1');

-- ---------------------------------------------------------------------------
-- (g) drill vendido = 2 linhas do caderno (sv1, sv3), líquido de estorno
-- ---------------------------------------------------------------------------
SELECT is(
  jsonb_array_length(public.get_productivity_activity_leads(
    '10001000-aaaa-0000-0000-000000001000',
    '2027-07-01 00:00-03','2027-07-31 23:59:59-03','vendido', NULL)),
  2, '(g) drill vendido = 2 linhas (sv2 estornada ausente)');

-- ---------------------------------------------------------------------------
-- (h) assert_org_access rejeita cross-org
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"10001000-aaaa-1111-0000-000000001000","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.get_productivity_activity('10001000-aaaa-0000-0000-000000001000','2027-07-01 00:00-03'::timestamptz,'2027-07-31 23:59:59-03'::timestamptz, NULL) $$,
  '(h) membro da org A lê produtividade da própria org');

SELECT throws_ok(
  $$ SELECT public.get_productivity_activity_by_seller('10001000-bbbb-0000-0000-000000001000','2027-07-01 00:00-03'::timestamptz,'2027-07-31 23:59:59-03'::timestamptz) $$,
  'P0001', NULL,
  '(h) membro da org A é BLOQUEADO na org B (assert_org_access)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
