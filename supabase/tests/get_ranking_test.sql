-- supabase/tests/get_ranking_test.sql
--
-- ISSUE #997 (PRD #986, ADR-0017 §2-5,§8) — pgTAP do leaderboard canônico de
-- venda get_ranking: lê SÓ sale_events, líquido de estorno, atribuição por
-- sale_responsible_id ÚNICO, período no tz da org. Mesma fonte/regra do #995 ⇒
-- pódio == dashboard.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/get_ranking_test.sql
--
-- Asserts:
--   (a) assinatura + grants
--   (b) atribuição ÚNICA: s8 (sale_responsible=c1, pre_sale=c2) credita SÓ c1,
--       nunca c2 nem dobra (mata R5/#3)
--   (c) net-of-reversal: venda estornada (s3) sai do pódio e da contagem
--   (d) Σ(por membro) + não-atribuído = revenue_total (invariante do #8/R5)
--   (e) ranking per-member == get_sales_metrics.by_closer nos MESMOS params
--       (pódio == dashboard, por construção)
--   (f) SEM bucket por metric_type: membro com metric_type='meetings' e vendas
--       ainda rankeia (mata #8); membro com receita 0 mas com venda aparece
--   (g) SEM predicado type='system': pipeline "custom" (qualquer pipeline_id)
--       rankeia; filtro por pipeline_id recorta 1 funil (mata R3)
--   (h) rank ordenado (1 = maior receita) e share ∈ [0,100]
--   (i) corte de período no tz da org (venda 23:30 do dia 31 local)
--   (j) assert_org_access rejeita cross-org

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_ranking',
  ARRAY['uuid','text','date','date','date','uuid'],
  '(a) get_ranking existe com a assinatura nomeada');

SELECT function_returns('public', 'get_ranking',
  ARRAY['uuid','text','date','date','date','uuid'], 'jsonb',
  '(a) retorna jsonb');

SELECT ok(
  has_function_privilege('authenticated', 'public.get_ranking(uuid,text,date,date,date,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_ranking(uuid,text,date,date,date,uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

-- ---------------------------------------------------------------------------
-- Fixtures (idênticas ao #995 pra fixar pódio == dashboard): 2 orgs (tz SP),
-- 2 closers, 2 pipelines. Seed sale_events DIRETO (teste de LEITOR): triggers
-- OFF + sold_at explícito + source='backfill'.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('99799799-aaaa-0000-0000-000000000997', 'Org A (#997)', 'org-a-997-rank', 'America/Sao_Paulo'),
  ('99799799-bbbb-0000-0000-000000000997', 'Org B (#997)', 'org-b-997-rank', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99799799-aaaa-1111-0000-000000000997', 'user-a-997@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Closer 2 com metric_type='meetings' de propósito: prova que o bucket de
-- metric_type NÃO decide o pódio de venda (mata #8).
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, metric_type)
VALUES
  ('99799799-aaaa-2222-0000-000000000997', '99799799-aaaa-0000-0000-000000000997',
   '99799799-aaaa-1111-0000-000000000997', 'Closer 1', 'admin', true, 'sales'),
  ('99799799-aaaa-2222-0001-000000000997', '99799799-aaaa-0000-0000-000000000997',
   NULL, 'Closer 2', 'member', true, 'meetings')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name)
VALUES ('99799799-aaaa-3333-0001-000000000997', '99799799-aaaa-0000-0000-000000000997', 'Lead 997')
ON CONFLICT (id) DO NOTHING;

-- P1 = 99799799-aaaa-4444-0001; P2 = 99799799-aaaa-4444-0002 (funil "custom":
-- pipeline_id qualquer, sem coluna type — get_ranking não tem predicado system).
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, pre_sale_responsible_id, source)
VALUES
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio','99799799-aaaa-2222-0000-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-11 12:00-03',500,'carteira','99799799-aaaa-2222-0000-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-12 12:00-03',2000,'novo_negocio','99799799-aaaa-2222-0001-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-13 12:00-03',300,'novo_negocio',NULL,NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-14 12:00-03',NULL,'novo_negocio','99799799-aaaa-2222-0001-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0002-000000000997','vendido','sale','2027-07-16 12:00-03',7777,'novo_negocio','99799799-aaaa-2222-0000-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-31 23:30-03',111,'novo_negocio','99799799-aaaa-2222-0000-000000000997',NULL,'backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','vendido','sale','2027-07-17 12:00-03',400,'novo_negocio','99799799-aaaa-2222-0000-000000000997','99799799-aaaa-2222-0001-000000000997','backfill'),
 ('99799799-aaaa-0000-0000-000000000997','99799799-aaaa-3333-0001-000000000997','99799799-aaaa-4444-0001-000000000997','perdido','sale_lost','2027-07-18 12:00-03',NULL,'novo_negocio','99799799-aaaa-2222-0000-000000000997',NULL,'backfill');

-- Estorno de s3 (2000, closer2): anula a venda inteira na leitura líquida.
INSERT INTO public.sale_events
  (organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source)
SELECT s.organization_id, s.lead_id, s.pipeline_id, 'esfriou', 'sale_reversed', s.id,
       '2027-07-25 12:00-03', s.sale_value, s.revenue_stream, s.sale_responsible_id, 'backfill'
FROM public.sale_events s
WHERE s.organization_id = '99799799-aaaa-0000-0000-000000000997'
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
-- Números líquidos de julho (s3 estornada fora):
--   c1 = 1000+500+7777+111+400 = 9788 (count 5)
--   c2 = 0 (s5 NULL-valor, count 1) — receita 0 mas COM venda
--   não-atribuído = 300 (s4, count 1)
--   total = 10088 (count 7)
-- ---------------------------------------------------------------------------

-- (b) atribuição única: c1 credita s8 (400), c2 NÃO.
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
   WHERE e->>'member_id' = '99799799-aaaa-2222-0000-000000000997'),
  9788::numeric, '(b) c1 = soma das próprias vendas por sale_responsible_id (inclui s8)');

SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
   WHERE e->>'member_id' = '99799799-aaaa-2222-0001-000000000997'),
  0::numeric, '(b) c2 NÃO é creditado por pre_sale (s8) nem pela estornada (s3)');

-- (c) net-of-reversal no total.
SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'revenue_total')::numeric,
  10088::numeric, '(c) revenue_total líquido de estorno');

SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'sale_count_total')::int,
  7, '(c) sale_count_total líquido de estorno (s3 fora)');

-- (d) Σ(membro) + não-atribuído = total.
SELECT is(
  (
    SELECT COALESCE(SUM((e->>'revenue')::numeric),0)
    FROM jsonb_array_elements(
      public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
  )
  + (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15')
       #>> '{unattributed,revenue}')::numeric,
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'revenue_total')::numeric,
  '(d) Σ(membro) + não-atribuído = revenue_total');

SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15')
      #>> '{unattributed,revenue}')::numeric,
  300::numeric, '(d) não-atribuído = venda sem sale_responsible_id (s4)');

-- (e) pódio == dashboard: ranking per-member == get_sales_metrics.by_closer.
SELECT is(
  (SELECT jsonb_agg(jsonb_build_object(
            'member_id', e->>'member_id',
            'revenue',   (e->>'revenue')::numeric,
            'sale_count',(e->>'sale_count')::int)
          ORDER BY (e->>'revenue')::numeric DESC, (e->>'sale_count')::int DESC)
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e),
  (SELECT jsonb_agg(jsonb_build_object(
            'member_id', e->>'member_id',
            'revenue',   (e->>'revenue')::numeric,
            'sale_count',(e->>'sale_count')::int)
          ORDER BY (e->>'revenue')::numeric DESC, (e->>'sale_count')::int DESC)
   FROM jsonb_array_elements(
     public.get_sales_metrics('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'by_closer') e),
  '(e) ranking per-member == get_sales_metrics.by_closer (pódio == dashboard)');

-- Mesma invariante embutida: revenue_total e unattributed batem entre as RPCs.
SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'revenue_total')::numeric,
  (public.get_sales_metrics('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') ->> 'revenue_total')::numeric,
  '(e) revenue_total idêntico ao get_sales_metrics');

-- (f) metric_type não esconde membro: c2 (metric_type=meetings, receita 0) aparece.
SELECT is(
  (SELECT count(*)::int
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e),
  2, '(f) ambos closers no pódio — metric_type não bucketiza (mata #8)');

SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
    WHERE e->>'member_id' = '99799799-aaaa-2222-0001-000000000997'),
  '(f) c2 (metric_type=meetings, receita 0 mas com venda) presente no pódio');

-- (g) SEM type='system': pipeline P2 (custom) rankeia; filtro por pipeline recorta.
SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15',
     NULL, NULL, '99799799-aaaa-4444-0002-000000000997') ->> 'revenue_total')::numeric,
  7777::numeric, '(g) pipeline P2 (custom) rankeia — sem predicado type=system (mata R3)');

SELECT is(
  (SELECT count(*)::int
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15',
       NULL, NULL, '99799799-aaaa-4444-0002-000000000997') -> 'ranking') e),
  1, '(g) só c1 no pódio de P2 (recorte por pipeline_id)');

-- (h) rank ordenado + share ∈ [0,100].
SELECT is(
  (SELECT (e->>'member_id')
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
   WHERE (e->>'rank')::int = 1),
  '99799799-aaaa-2222-0000-000000000997', '(h) rank 1 = maior receita (c1)');

SELECT ok(
  (SELECT bool_and((e->>'revenue_share')::numeric BETWEEN 0 AND 100)
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e),
  '(h) revenue_share ∈ [0,100] pra todo membro');

SELECT is(
  (SELECT (e->>'revenue_share')::numeric
   FROM jsonb_array_elements(
     public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') -> 'ranking') e
   WHERE (e->>'rank')::int = 1),
  round(9788::numeric / 10088 * 100, 2), '(h) share do líder = revenue/total');

-- (i) corte de período no tz da org.
SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','day','2027-07-31') ->> 'revenue_total')::numeric,
  111::numeric, '(i) venda 23:30 do dia 31 (tz org) aparece no DIA 31 local');

SELECT is(
  (public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-08-15') ->> 'revenue_total')::numeric,
  0::numeric, '(i) mesma venda NÃO vaza pra agosto (corte no tz da org)');

-- (j) assert_org_access rejeita cross-org.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99799799-aaaa-1111-0000-000000000997","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.get_ranking('99799799-aaaa-0000-0000-000000000997','month','2027-07-15') $$,
  '(j) membro da org A lê o pódio da própria org');

SELECT throws_ok(
  $$ SELECT public.get_ranking('99799799-bbbb-0000-0000-000000000997','month','2027-07-15') $$,
  'P0001', NULL,
  '(j) membro da org A é BLOQUEADO na org B (assert_org_access)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
