-- supabase/tests/get_sales_metrics_test.sql
--
-- ISSUE #995 (PRD #986, ADR-0017 §2-5,§8) — pgTAP do leitor canônico de venda
-- get_sales_metrics: lê SÓ sale_events, líquido de estorno, período no tz da
-- org, atribuição por sale_responsible_id único.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/get_sales_metrics_test.sql
--
-- Asserts:
--   (a) assinatura e grants
--   (b) net-of-reversal: sale + sale_reversed → some da receita E da contagem
--   (c) split por stream soma ao total (novo_negocio + carteira = revenue_total)
--   (d) invariante Σ(por closer) + não-atribuído = total
--   (e) corte de período no tz da org: venda 23:30 do último dia local cai no
--       mês certo (org tz), ausente do mês seguinte
--   (f) filtro por pipeline_id (1 funil vs todos)
--   (g) filtro por membro usa SÓ sale_responsible_id (não pre_sale/outras chaves)
--   (h) ticket médio NULL-safe: 0 vendas → NULL (nunca /0, nunca 0 forjado)
--   (i) sale_lost conta em lost_count e NUNCA em receita
--   (j) assert_org_access rejeita cross-org

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_sales_metrics',
  ARRAY['uuid','text','date','date','date','uuid','uuid'],
  '(a) get_sales_metrics existe com a assinatura nomeada');

SELECT function_returns('public', 'get_sales_metrics',
  ARRAY['uuid','text','date','date','date','uuid','uuid'], 'jsonb',
  '(a) retorna jsonb');

SELECT ok(
  has_function_privilege('authenticated', 'public.get_sales_metrics(uuid,text,date,date,date,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_sales_metrics(uuid,text,date,date,date,uuid,uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs (tz America/Sao_Paulo), 2 closers, 2 pipelines.
-- Semeia sale_events DIRETO (é um teste de LEITOR): triggers OFF + sold_at
-- explícito + source='backfill' pra controlar âncora temporal e período.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('99599599-aaaa-0000-0000-000000000995', 'Org A (#995)', 'org-a-995-gsm', 'America/Sao_Paulo'),
  ('99599599-bbbb-0000-0000-000000000995', 'Org B (#995)', 'org-b-995-gsm', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99599599-aaaa-1111-0000-000000000995', 'user-a-995@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('99599599-aaaa-2222-0000-000000000995', '99599599-aaaa-0000-0000-000000000995',
   '99599599-aaaa-1111-0000-000000000995', 'Closer 1', 'admin', true),
  ('99599599-aaaa-2222-0001-000000000995', '99599599-aaaa-0000-0000-000000000995',
   NULL, 'Closer 2', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES ('99599599-aaaa-3333-0001-000000000995', '99599599-aaaa-0000-0000-000000000995', 'Lead 995')
ON CONFLICT (id) DO NOTHING;

-- Pipeline IDs (sem FK em sale_events.pipeline_id — basta um uuid estável).
-- P1 = 99599599-aaaa-4444-0001; P2 = 99599599-aaaa-4444-0002.

-- Vendas de JULHO/2027, org A, pipeline P1 (salvo nota):
--  s1 closer1 novo_negocio 1000 (NÃO estornada)
--  s2 closer1 carteira      500 (NÃO estornada)
--  s3 closer2 novo_negocio 2000 (ESTORNADA — sai da receita e da contagem)
--  s4 sem closer novo_negocio 300 (bucket não-atribuído)
--  s5 closer2 novo_negocio NULL-valor (conta, receita 0)
--  s6 closer1 novo_negocio 7777 no pipeline P2 (filtro de pipeline)
--  s7 closer1 novo_negocio 111 na fronteira de tz (31/07 23:30 local)
--  s8 pre_sale=closer2 mas sale_responsible=closer1, 400 (filtro de membro)
--  lost1 closer1 sale_lost (nunca receita)
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, pre_sale_responsible_id, source)
VALUES
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio','99599599-aaaa-2222-0000-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-11 12:00-03',500,'carteira','99599599-aaaa-2222-0000-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-12 12:00-03',2000,'novo_negocio','99599599-aaaa-2222-0001-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-13 12:00-03',300,'novo_negocio',NULL,NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-14 12:00-03',NULL,'novo_negocio','99599599-aaaa-2222-0001-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0002-000000000995','vendido','sale','2027-07-16 12:00-03',7777,'novo_negocio','99599599-aaaa-2222-0000-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-31 23:30-03',111,'novo_negocio','99599599-aaaa-2222-0000-000000000995',NULL,'backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','vendido','sale','2027-07-17 12:00-03',400,'novo_negocio','99599599-aaaa-2222-0000-000000000995','99599599-aaaa-2222-0001-000000000995','backfill'),
 ('99599599-aaaa-0000-0000-000000000995','99599599-aaaa-3333-0001-000000000995','99599599-aaaa-4444-0001-000000000995','perdido','sale_lost','2027-07-18 12:00-03',NULL,'novo_negocio','99599599-aaaa-2222-0000-000000000995',NULL,'backfill');

-- Estorno de s3 (mais tarde no mês) — anula a venda de 2000 do closer2.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
SELECT s.organization_id, s.lead_id, s.pipeline_id, 'esfriou', 'sale_reversed', s.id,
       '2027-07-25 12:00-03', s.sale_value, s.revenue_stream, s.sale_responsible_id, 'backfill'
FROM public.sale_events s
WHERE s.organization_id = '99599599-aaaa-0000-0000-000000000995'
  AND s.event_type = 'sale' AND s.sale_value = 2000;

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
-- (b) Net-of-reversal + (c) stream split + (d) invariante closers
-- Full month julho: s1,s2,s4,s5,s6,s7,s8 = 7 vendas líquidas (s3 estornada).
-- receita = 1000+500+300+0+7777+111+400 = 10088; carteira 500; novo 9588.
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'won_count')::int,
  7, '(b) won_count líquido de estorno (s3 estornada não conta)');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'revenue_total')::numeric,
  10088::numeric, '(b) revenue_total líquido de estorno');

SELECT is(
  ( (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
        #>> '{revenue_by_stream,novo_negocio,revenue}')::numeric
  + (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
        #>> '{revenue_by_stream,carteira,revenue}')::numeric ),
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'revenue_total')::numeric,
  '(c) novo_negocio + carteira = revenue_total (por construção)');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
      #>> '{revenue_by_stream,carteira,revenue}')::numeric,
  500::numeric, '(c) stream carteira isolado corretamente');

-- Σ(por closer) + não-atribuído = total.
SELECT is(
  (
    SELECT COALESCE(SUM((elem ->> 'revenue')::numeric), 0)
    FROM jsonb_array_elements(
      public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') -> 'by_closer'
    ) elem
  )
  + (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
       #>> '{unattributed,revenue}')::numeric,
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'revenue_total')::numeric,
  '(d) Σ(closers) + não-atribuído = revenue_total');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
      #>> '{unattributed,revenue}')::numeric,
  300::numeric, '(d) bucket não-atribuído = venda sem sale_responsible_id (s4)');

-- ---------------------------------------------------------------------------
-- (e) Corte de período no tz da org
-- s7 = 31/07 23:30 America/Sao_Paulo (== 01/08 02:30 UTC). Cai em JULHO local,
-- ausente de AGOSTO.
-- ---------------------------------------------------------------------------
SELECT ok(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','day','2027-07-31') ->> 'revenue_total')::numeric = 111,
  '(e) venda 23:30 do dia 31 (tz org) aparece no DIA 31 local');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-08-15') ->> 'revenue_total')::numeric,
  0::numeric, '(e) mesma venda NÃO vaza pra agosto (corte no tz da org, não UTC)');

-- ---------------------------------------------------------------------------
-- (f) Filtro por pipeline_id
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15',
      NULL, NULL, '99599599-aaaa-4444-0002-000000000995') ->> 'revenue_total')::numeric,
  7777::numeric, '(f) pipeline_id filtra pra 1 funil (P2 = 7777)');

SELECT ok(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15',
      NULL, NULL, '99599599-aaaa-4444-0001-000000000995') ->> 'revenue_total')::numeric
   = 10088 - 7777,
  '(f) pipeline P1 = total menos P2 (todos os funis quando NULL)');

-- ---------------------------------------------------------------------------
-- (g) Filtro por membro usa SÓ sale_responsible_id
-- s8: sale_responsible=closer1, pre_sale=closer2. Filtrar por closer2 NÃO deve
-- trazer s8 (pre_sale não é chave de atribuição de venda — mata R5).
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15',
      NULL, NULL, NULL, '99599599-aaaa-2222-0001-000000000995') ->> 'won_count')::int,
  1, '(g) filtro por closer2 = só s5 (NULL-valor); s8 pre_sale=closer2 NÃO entra');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15',
      NULL, NULL, NULL, '99599599-aaaa-2222-0000-000000000995') ->> 'revenue_total')::numeric,
  -- `::numeric` explícito: `is()` do pgTAP é `anyelement, anyelement`, e a soma
  -- de literais inteiros dá INTEGER. Sem o cast, o par vira
  -- `is(numeric, integer)` e o Postgres nem acha a função — a suíte aborta ali,
  -- sem chegar às nove asserções seguintes.
  (1000 + 500 + 7777 + 111 + 400)::numeric,  -- s1,s2,s6,s7,s8 do closer1
  '(g) filtro por closer1 soma só as vendas dele (sale_responsible_id)');

-- ---------------------------------------------------------------------------
-- (h) Ticket médio NULL-safe
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'ticket_medio')::numeric,
  round(10088::numeric / 7, 2), '(h) ticket_medio = receita líquida / vendas líquidas');

SELECT ok(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-01-15') -> 'ticket_medio') = 'null'::jsonb,
  '(h) 0 vendas → ticket_medio NULL (nunca /0, nunca 0 forjado)');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-01-15') ->> 'revenue_total')::numeric,
  0::numeric, '(h) período vazio → revenue_total 0');

-- ---------------------------------------------------------------------------
-- (i) sale_lost em lost_count, nunca em receita
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'lost_count')::int,
  1, '(i) lost_count conta o sale_lost');

SELECT ok(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') ->> 'revenue_total')::numeric
   = 10088,
  '(i) sale_lost NÃO adiciona receita (total inalterado)');

-- ---------------------------------------------------------------------------
-- (j) assert_org_access rejeita cross-org
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99599599-aaaa-1111-0000-000000000995","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') $$,
  '(j) membro da org A lê métricas da própria org');

SELECT throws_ok(
  $$ SELECT public.get_sales_metrics('99599599-bbbb-0000-0000-000000000995','month','2027-07-15') $$,
  'P0001', NULL,
  '(j) membro da org A é BLOQUEADO na org B (assert_org_access)');

SET LOCAL role postgres;

-- Sanidade extra: by_closer não contém o bucket NULL (fica em unattributed).
SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15') -> 'by_closer'
    ) elem
    WHERE elem ->> 'member_id' IS NULL
  ),
  0, '(d) by_closer nunca inclui member_id NULL (vai pro bucket não-atribuído)');

SELECT is(
  (public.get_sales_metrics('99599599-aaaa-0000-0000-000000000995','month','2027-07-15')
      #>> '{revenue_by_stream,novo_negocio,revenue}')::numeric,
  9588::numeric, '(c) stream novo_negocio = total menos carteira');

SELECT * FROM finish();

ROLLBACK;
