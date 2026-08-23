-- supabase/tests/get_commission_ledger_test.sql
--
-- ISSUE #997 (PRD #986, ADR-0017 §6,§8) — pgTAP do leitor de comissão-como-ledger
-- get_commission_ledger: lê SÓ a projeção (commissions.source='sale_event_projection',
-- #994), líquida de estorno (anti-join na venda, igual ao pódio), período no tz
-- da org, taxa/amount snapshotados. Fecha o par que mata "pódio × comissão".
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/get_commission_ledger_test.sql
--
-- Asserts:
--   (a) assinatura + grants
--   (b) totais (comissão líquida, base, contagem)
--   (c) net-of-reversal: venda estornada (e4) some da comissão E da base
--   (d) por membro: comissão + base corretas (atribuição por team_member_id único)
--   (e) quebra por tipo (mrr|projeto) com taxa snapshotada
--   (f) rate snapshot: mudar a taxa do membro DEPOIS não move o ledger
--   (g) R5-KILLER: conjunto de membros do ledger == conjunto do pódio (get_ranking)
--       e base_revenue por membro == get_ranking.revenue por membro (venda no
--       pódio ⟺ linha de comissão)
--   (h) filtro por membro (só sale_responsible_id/team_member_id)
--   (i) corte de período no tz da org
--   (j) assert_org_access rejeita cross-org

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_commission_ledger',
  ARRAY['uuid','text','date','date','date','uuid'],
  '(a) get_commission_ledger existe com a assinatura nomeada');

SELECT function_returns('public', 'get_commission_ledger',
  ARRAY['uuid','text','date','date','date','uuid'], 'jsonb',
  '(a) retorna jsonb');

SELECT ok(
  has_function_privilege('authenticated', 'public.get_commission_ledger(uuid,text,date,date,date,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_commission_ledger(uuid,text,date,date,date,uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

-- ---------------------------------------------------------------------------
-- Fixtures: seed sale_events (ids explícitos p/ referência) + projeção manual
-- (triggers OFF ⇒ backfill não projeta; semeamos a projeção à mão). Org tz SP.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('99899899-aaaa-0000-0000-000000000997', 'Org A (#997 comm)', 'org-a-997-comm', 'America/Sao_Paulo'),
  ('99899899-bbbb-0000-0000-000000000997', 'Org B (#997 comm)', 'org-b-997-comm', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99899899-aaaa-1111-0000-000000000997', 'user-a-997-comm@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members
  (id, organization_id, user_id, name, role, is_active,
   commission_mrr_percent, commission_projeto_percent)
VALUES
  ('99899899-aaaa-2222-0000-000000000997', '99899899-aaaa-0000-0000-000000000997',
   '99899899-aaaa-1111-0000-000000000997', 'Closer 1', 'admin', true, 2.0, 1.0),
  ('99899899-aaaa-2222-0001-000000000997', '99899899-aaaa-0000-0000-000000000997',
   NULL, 'Closer 2', 'member', true, 5.0, 1.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES ('99899899-aaaa-3333-0001-000000000997', '99899899-aaaa-0000-0000-000000000997', 'Lead 997c')
ON CONFLICT (id) DO NOTHING;

-- sale_events com ids explícitos:
--   e1 c1 mrr     1000  2027-07-10
--   e2 c1 projeto 2000  2027-07-11
--   e3 c2 mrr      500  2027-07-12
--   e4 c1 mrr     3000  2027-07-13  ESTORNADA (e4r)
--   e5 SEM closer  800  2027-07-14  (sem projeção — não-atribuído)
--   e6 c1 mrr     NULL  2027-07-15  (projeção amount 0)
--   e7 c1 mrr      100  2027-07-31 23:30 local (fronteira tz)
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
VALUES
 ('99899899-e001-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill'),
 ('99899899-e002-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-11 12:00-03',2000,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill'),
 ('99899899-e003-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-12 12:00-03',500,'novo_negocio','99899899-aaaa-2222-0001-000000000997','backfill'),
 ('99899899-e004-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-13 12:00-03',3000,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill'),
 ('99899899-e005-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-14 12:00-03',800,'novo_negocio',NULL,'backfill'),
 ('99899899-e006-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-15 12:00-03',NULL,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill'),
 ('99899899-e007-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','vendido','sale','2027-07-31 23:30-03',100,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill');

-- Estorno de e4.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id,
   sold_at, sale_value, revenue_stream, sale_responsible_id, source)
VALUES
 ('99899899-e044-0000-0000-000000000997','99899899-aaaa-0000-0000-000000000997','99899899-aaaa-3333-0001-000000000997','99899899-aaaa-4444-0001-000000000997','esfriou','sale_reversed','99899899-e004-0000-0000-000000000997','2027-07-25 12:00-03',3000,'novo_negocio','99899899-aaaa-2222-0000-000000000997','backfill');

-- Projeção manual (source='sale_event_projection'), amount = base * rate/100.
--   e1 mrr 2%   → 20   | e2 projeto 1% → 20 | e3 mrr 5% → 25
--   e4 mrr 2%   → 60 (+ estorno e044 → -60, mês da original) | e6 mrr 2% → 0
--   e7 mrr 2%   → 2
INSERT INTO public.commissions
  (organization_id, team_member_id, amount, type, month, year, paid,
   sale_event_id, source, rate_percent)
VALUES
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',20,'mrr',7,2027,false,'99899899-e001-0000-0000-000000000997','sale_event_projection',2.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',20,'projeto',7,2027,false,'99899899-e002-0000-0000-000000000997','sale_event_projection',1.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0001-000000000997',25,'mrr',7,2027,false,'99899899-e003-0000-0000-000000000997','sale_event_projection',5.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',60,'mrr',7,2027,false,'99899899-e004-0000-0000-000000000997','sale_event_projection',2.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',-60,'mrr',7,2027,false,'99899899-e044-0000-0000-000000000997','sale_event_projection',2.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',0,'mrr',7,2027,false,'99899899-e006-0000-0000-000000000997','sale_event_projection',2.0),
 ('99899899-aaaa-0000-0000-000000000997','99899899-aaaa-2222-0000-000000000997',2,'mrr',7,2027,false,'99899899-e007-0000-0000-000000000997','sale_event_projection',2.0);

SET LOCAL session_replication_role = origin;

-- Contexto de BACKEND a partir daqui (SCRUM-361).
--
-- Sem isto a suíte morre na primeira escrita/leitura que passa por um gate:
-- `fn_pipeline_stages_guard_money_role` recusa won/lost, e `assert_org_access`
-- recusa a RPC — as duas com P0001, que aborta o arquivo inteiro e vira
-- "Bad plan. You planned N tests but ran M".
--
-- O comentario antigo dizia "seed de sistema como superusuario". Isso NUNCA foi
-- verdade: medido em producao, `postgres` tem rolsuper=false (so `supabase_admin`
-- e superusuario). O ramo `rolsuper` do guard nunca disparou para esta suite, em
-- lugar nenhum. O caminho privilegiado REAL e o backend — quem semeia funil em
-- producao e a edge function de provisionamento, com service_role.
--
-- A autorizacao continua provada onde ela e o assunto: as secoes de membro e de
-- cross-org trocam de papel explicitamente mais abaixo.
SET LOCAL role service_role;
-- E o CLAIM, nao so o papel do Postgres: `assert_org_access` decide por
-- `auth.role()`, que le `request.jwt.claims`. Medido no CI — com SET ROLE
-- sozinho a RPC continuava recusando com access_denied.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------------------------------------------------------------------
-- Números líquidos de julho (e4 estornada fora; e5 sem projeção):
--   c1: comissão 20+20+0+2 = 42 ; base 1000+2000+0+100 = 3100 ; count 4
--       mrr: comissão 20+0+2 = 22, base 1000+100 = 1100, count 3, rate 2
--       projeto: comissão 20, base 2000, count 1, rate 1
--   c2: comissão 25 ; base 500 ; count 1
--   total: comissão 67 ; base 3600 ; count 5
-- ---------------------------------------------------------------------------

-- (b) totais.
SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'commission_total')::numeric,
  67::numeric, '(b) commission_total líquido de estorno');

SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'base_revenue_total')::numeric,
  3600::numeric, '(b) base_revenue_total (mesmas vendas do pódio)');

SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'sale_count_total')::int,
  5, '(b) sale_count_total (e4 estornada e e5 não-atribuída fora)');

-- (c) net-of-reversal por membro (c1 sem os +60/+3000 da e4).
SELECT is(
  (SELECT (e->>'commission')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  42::numeric, '(c) c1 comissão sem a venda estornada (42, não 102)');

SELECT is(
  (SELECT (e->>'base_revenue')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  3100::numeric, '(c) c1 base sem a venda estornada (3100, não 6100)');

-- (d) por membro.
SELECT is(
  (SELECT (e->>'commission')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0001-000000000997'),
  25::numeric, '(d) c2 comissão = 25 (atribuição por team_member_id único)');

SELECT is(
  (SELECT (e->>'base_revenue')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0001-000000000997'),
  500::numeric, '(d) c2 base = 500');

-- (e) quebra por tipo + taxa snapshotada.
SELECT is(
  (SELECT (e #>> '{by_type,mrr,commission}')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  22::numeric, '(e) c1 mrr comissão = 22');

SELECT is(
  (SELECT (e #>> '{by_type,mrr,rate_percent}')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  2.0::numeric, '(e) c1 mrr taxa snapshotada = 2%');

SELECT is(
  (SELECT (e #>> '{by_type,projeto,commission}')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  20::numeric, '(e) c1 projeto comissão = 20');

SELECT is(
  (SELECT (e #>> '{by_type,projeto,rate_percent}')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  1.0::numeric, '(e) c1 projeto taxa snapshotada = 1%');

-- (f) rate snapshot: mudar a taxa do membro DEPOIS não move o ledger.
--
-- `session_replication_role` é parâmetro de SUPERUSUÁRIO, e a suíte roda como
-- `service_role` daqui para cima (o contexto de backend que `assert_org_access`
-- exige). Volta a `postgres` só para desarmar os gatilhos e devolve o papel em
-- seguida — sem isso o apply morre com "permission denied to set parameter".
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
UPDATE public.team_members
  SET commission_mrr_percent = 99.0, commission_projeto_percent = 99.0
  WHERE id = '99899899-aaaa-2222-0000-000000000997';
SET LOCAL session_replication_role = origin;
SET LOCAL role service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT is(
  (SELECT (e->>'commission')::numeric
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e
   WHERE e->>'member_id' = '99899899-aaaa-2222-0000-000000000997'),
  42::numeric, '(f) taxa mudada depois NÃO move o ledger (amount snapshotado)');

-- (g) R5-KILLER: membros do ledger == membros do pódio + base == revenue.
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object('m', e->>'member_id', 'r', (e->>'base_revenue')::numeric)
          ORDER BY e->>'member_id')
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_member') e),
  (SELECT jsonb_agg(jsonb_build_object('m', e->>'member_id', 'r', (e->>'revenue')::numeric)
          ORDER BY e->>'member_id')
   FROM jsonb_array_elements(
     public.get_ranking('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e),
  '(g) R5-killer: membros do ledger == pódio, base_revenue == get_ranking.revenue');

-- (h) filtro por membro.
SELECT is(
  (SELECT count(*)::int
   FROM jsonb_array_elements(
     public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15',
       NULL, NULL, '99899899-aaaa-2222-0001-000000000997') -> 'by_member') e),
  1, '(h) filtro por c2 = 1 membro no ledger');

SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15',
     NULL, NULL, '99899899-aaaa-2222-0001-000000000997') ->> 'commission_total')::numeric,
  25::numeric, '(h) filtro por c2 = comissão 25');

-- (i) corte de período no tz da org (e7 = 31/07 23:30 local).
SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','day','2027-07-31') ->> 'commission_total')::numeric,
  2::numeric, '(i) e7 (23:30 do dia 31, tz org) cai no DIA 31 local (comissão 2)');

SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-08-15') ->> 'commission_total')::numeric,
  0::numeric, '(i) agosto vazio (corte no tz da org, não UTC)');

SELECT is(
  (public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-08-15') -> 'by_member'),
  '[]'::jsonb, '(i) período vazio → by_member []');

-- (j) assert_org_access rejeita cross-org.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99899899-aaaa-1111-0000-000000000997","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.get_commission_ledger('99899899-aaaa-0000-0000-000000000997','month','2027-07-15') $$,
  '(j) membro da org A lê o ledger da própria org');

SELECT throws_ok(
  $$ SELECT public.get_commission_ledger('99899899-bbbb-0000-0000-000000000997','month','2027-07-15') $$,
  'P0001', NULL,
  '(j) membro da org A é BLOQUEADO na org B (assert_org_access)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
