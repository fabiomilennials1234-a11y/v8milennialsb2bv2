-- supabase/tests/get_funnel_flow_test.sql
--
-- ISSUE #996 (PRD #986, ADR-0017 §1,§5,§7,§8) — pgTAP do leitor canônico de
-- funil get_funnel_flow: modelo coorte/fluxo lendo SÓ pipeline_stage_events,
-- semântica de etapa SÓ por stage_role governado, coorte cortada no tz da org.
--
-- Run:
--   supabase test db
-- or:
--   pg_prove -d "$DATABASE_URL" supabase/tests/get_funnel_flow_test.sql
--
-- Asserts:
--   (a) assinatura, retorno e grants
--   (b) coorte = SÓ quem entrou no pipeline no período (entrada em junho fora)
--   (c) monotonicidade non-increasing por construção MESMO com pulo de etapa
--       (lead vai direto pra won: conta em open/booked/held/won)
--   (d) taxas ∈ [0,100]; conversion_from_top(open)=100
--   (e) conversion_from_prev NULL-safe em degrau vazio (prev=0 → NULL, não 100
--       — mata o #6); primeiro degrau (open) tem from_prev NULL
--   (f) funil de pipeline CUSTOM (type='custom') devolve números REAIS, não zero
--       (R3 — sem predicado type='system'); custom sem governança ≙ open
--   (g) fronteira de coorte no tz da org: entrada 23:30 -03 do último dia cai no
--       mês certo (org tz), ausente do mês seguinte
--   (h) p_pipeline_id obrigatório (funil é por-pipeline)
--   (i) assert_org_access rejeita cross-org

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(23);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'get_funnel_flow',
  ARRAY['uuid','uuid','text','date','date','date'],
  '(a) get_funnel_flow existe com a assinatura nomeada');

SELECT function_returns('public', 'get_funnel_flow',
  ARRAY['uuid','uuid','text','date','date','date'], 'jsonb',
  '(a) retorna jsonb');

SELECT ok(
  has_function_privilege('authenticated', 'public.get_funnel_flow(uuid,uuid,text,date,date,date)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_funnel_flow(uuid,uuid,text,date,date,date)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

-- ---------------------------------------------------------------------------
-- Fixtures: 2 orgs (tz America/Sao_Paulo). Pipeline SYSTEM slug='propostas'
-- com stage_keys governados cobrindo TODOS os roles (seed explícito em
-- pipeline_stages: pipeline_type IN os 3 slugs de sistema, mas stage_role é
-- livre). Pipeline CUSTOM slug='cust996' type='custom' SEM governança de role
-- (metric_stage_role → NULL ≙ open). Semeia pipeline_stage_events DIRETO
-- (é teste de LEITOR): triggers OFF + occurred_at explícito pra controlar
-- âncora de entrada e período.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('99699699-aaaa-0000-0000-000000000996', 'Org A (#996)', 'org-a-996-gff', 'America/Sao_Paulo'),
  ('99699699-bbbb-0000-0000-000000000996', 'Org B (#996)', 'org-b-996-gff', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99699699-aaaa-1111-0000-000000000996', 'user-a-996@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('99699699-aaaa-2222-0000-000000000996', '99699699-aaaa-0000-0000-000000000996',
   '99699699-aaaa-1111-0000-000000000996', 'Membro A', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- Pipelines: P_SYS (system, slug propostas) e P_CUST (custom, sem governança).
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES
  ('99699699-aaaa-4444-0001-000000000996', '99699699-aaaa-0000-0000-000000000996', 'Funil Sistema', 'propostas', 'system'),
  ('99699699-aaaa-4444-0002-000000000996', '99699699-aaaa-0000-0000-000000000996', 'Funil Custom',  'cust996',   'custom')
ON CONFLICT (id) DO NOTHING;

-- Governança de role do P_SYS: stage_keys próprios cobrindo os 5 roles.
-- stage_role explícito (≠ 'open') é preservado pelo trigger de assign.
INSERT INTO public.pipeline_stages (id, organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES
  ('99699699-aaaa-5555-0000-000000000996', '99699699-aaaa-0000-0000-000000000996', 'propostas', 's_open', 'Aberto',    0, 'open'),
  ('99699699-aaaa-5555-0001-000000000996', '99699699-aaaa-0000-0000-000000000996', 'propostas', 's_book', 'Reuniao',   1, 'meeting_booked'),
  ('99699699-aaaa-5555-0002-000000000996', '99699699-aaaa-0000-0000-000000000996', 'propostas', 's_held', 'Compareceu',2, 'meeting_held'),
  ('99699699-aaaa-5555-0003-000000000996', '99699699-aaaa-0000-0000-000000000996', 'propostas', 's_won',  'Vendido',   3, 'won'),
  ('99699699-aaaa-5555-0004-000000000996', '99699699-aaaa-0000-0000-000000000996', 'propostas', 's_lost', 'Perdido',   4, 'lost')
ON CONFLICT (organization_id, pipeline_type, stage_key) DO UPDATE SET stage_role = EXCLUDED.stage_role;

-- Leads (org A). L1..L6,L8 entram em JULHO; L7 entra em JUNHO (fora da coorte).
-- LC1,LC2 no pipeline custom.
INSERT INTO public.leads (id, organization_id, name)
VALUES
  ('99699699-aaaa-3333-0001-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L1'),
  ('99699699-aaaa-3333-0002-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L2'),
  ('99699699-aaaa-3333-0003-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L3'),
  ('99699699-aaaa-3333-0004-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L4'),
  ('99699699-aaaa-3333-0005-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L5'),
  ('99699699-aaaa-3333-0006-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L6'),
  ('99699699-aaaa-3333-0007-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L7'),
  ('99699699-aaaa-3333-0008-000000000996', '99699699-aaaa-0000-0000-000000000996', 'L8'),
  ('99699699-aaaa-3333-00c1-000000000996', '99699699-aaaa-0000-0000-000000000996', 'LC1'),
  ('99699699-aaaa-3333-00c2-000000000996', '99699699-aaaa-0000-0000-000000000996', 'LC2')
ON CONFLICT (id) DO NOTHING;

-- Eventos do caderno. Entrada = from_stage_key NULL. P_SYS = 4444-0001.
--   L1: open→book→held→won  (max_rank 3)
--   L2: open→won            (PULA book/held; max_rank 3 — testa monotonicidade)
--   L3: open→book→held      (max_rank 2)
--   L4: open→book           (max_rank 1)
--   L5: open                (max_rank 0)
--   L6: open→book→lost      (max_rank 1, ever_lost)
--   L7: open em JUNHO, won em julho — FORA da coorte de julho (entrada junho)
--   L8: open 31/07 23:30 -03 (fronteira de tz — cai em JULHO local)
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, from_stage_key, to_stage_key, occurred_at, source)
VALUES
  -- L1
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0001-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0001-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_book', '2027-07-06 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0001-000000000996','99699699-aaaa-4444-0001-000000000996', 's_book', 's_held', '2027-07-07 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0001-000000000996','99699699-aaaa-4444-0001-000000000996', 's_held', 's_won',  '2027-07-08 10:00-03','backfill'),
  -- L2 (pula etapas)
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0002-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 11:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0002-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_won',  '2027-07-09 11:00-03','backfill'),
  -- L3
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0003-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 12:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0003-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_book', '2027-07-06 12:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0003-000000000996','99699699-aaaa-4444-0001-000000000996', 's_book', 's_held', '2027-07-07 12:00-03','backfill'),
  -- L4
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0004-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 13:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0004-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_book', '2027-07-06 13:00-03','backfill'),
  -- L5
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0005-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 14:00-03','backfill'),
  -- L6 (lost)
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0006-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-05 15:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0006-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_book', '2027-07-06 15:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0006-000000000996','99699699-aaaa-4444-0001-000000000996', 's_book', 's_lost', '2027-07-10 15:00-03','backfill'),
  -- L7 (entrada JUNHO — fora da coorte de julho)
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0007-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-06-20 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0007-000000000996','99699699-aaaa-4444-0001-000000000996', 's_open', 's_won',  '2027-07-15 10:00-03','backfill'),
  -- L8 (fronteira tz: 31/07 23:30 -03)
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-0008-000000000996','99699699-aaaa-4444-0001-000000000996', NULL,     's_open', '2027-07-31 23:30-03','backfill'),
  -- LC1, LC2 no pipeline CUSTOM (roles NULL ≙ open)
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-00c1-000000000996','99699699-aaaa-4444-0002-000000000996', NULL,      'c_novo', '2027-07-05 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-00c1-000000000996','99699699-aaaa-4444-0002-000000000996', 'c_novo',  'c_prog', '2027-07-06 10:00-03','backfill'),
  ('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-3333-00c2-000000000996','99699699-aaaa-4444-0002-000000000996', NULL,      'c_novo', '2027-07-05 11:00-03','backfill');

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
-- (b) Coorte = só entrantes no período. Julho/P_SYS: L1..L6,L8 = 7 (L7 junho fora).
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') ->> 'cohort_size')::int,
  7, '(b) coorte de julho = 7 (L7 entrou em junho e NÃO conta)');

-- ---------------------------------------------------------------------------
-- (c) Alcance por role + monotonicidade (com pulo de etapa via L2).
-- reached: open=7, booked=5 (L1,L2,L3,L4,L6), held=3 (L1,L2,L3), won=2 (L1,L2).
-- L2 pulou book/held mas conta em ambos por construção.
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,0,reached_count}')::int,
  7, '(c) reached(open) = 7 (== coorte por construção)');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,1,reached_count}')::int,
  5, '(c) reached(meeting_booked) = 5');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,2,reached_count}')::int,
  3, '(c) reached(meeting_held) = 3 (inclui L2 que pulou held)');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,3,reached_count}')::int,
  2, '(c) reached(won) = 2 (L1, L2)');

-- Monotonicidade non-increasing across the 4 steps.
SELECT ok(
  (
    -- A janela precisa de um nível PRÓPRIO: agregado não pode conter chamada de
    -- função de janela ("aggregate function calls cannot contain window
    -- function calls"), e o erro aborta o arquivo inteiro — 8 de 23 asserções
    -- é onde esta suíte parava.
    SELECT bool_and(nao_alargou)
    FROM (
      SELECT rc >= lead(rc) OVER (ORDER BY ord) AS nao_alargou
      FROM (
        SELECT ord, (step ->> 'reached_count')::int AS rc
        FROM jsonb_array_elements(
          public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') -> 'steps'
        ) WITH ORDINALITY AS t(step, ord)
      ) s
    ) w
  ) IS NOT FALSE,
  '(c) degraus non-increasing por construção (funil nunca alarga)');

-- lost em balde terminal separado.
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') ->> 'lost_count')::int,
  1, '(c) lost_count = 1 (L6), balde terminal separado da cadeia');

-- ---------------------------------------------------------------------------
-- (d) Taxas ∈ [0,100]; conversion_from_top(open) = 100.
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,0,conversion_from_top}')::numeric,
  100.0::numeric, '(d) conversion_from_top(open) = 100');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,3,conversion_from_top}')::numeric,
  round(2::numeric/7*100,1), '(d) conversion_from_top(won) = 2/7 (≈28.6)');
SELECT ok(
  (
    SELECT bool_and(
      (step ->> 'conversion_from_top')::numeric BETWEEN 0 AND 100
      AND ( (step ->> 'conversion_from_prev') IS NULL
            OR (step ->> 'conversion_from_prev')::numeric BETWEEN 0 AND 100 )
    )
    FROM jsonb_array_elements(
      public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') -> 'steps'
    ) AS step
  ),
  '(d) todas as taxas ∈ [0,100] (ou NULL)');

-- conversion_from_prev(held) = 3/5 = 60.0; (won) = 2/3 ≈ 66.7 — valores reais, não 100.
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #>> '{steps,2,conversion_from_prev}')::numeric,
  60.0::numeric, '(d) conversion_from_prev(held) = 3/5 = 60 (não 100 — mata #6)');

-- ---------------------------------------------------------------------------
-- (e) NULL-safe: primeiro degrau (open) from_prev NULL; degrau vazio → NULL.
-- ---------------------------------------------------------------------------
SELECT ok(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') #> '{steps,0,conversion_from_prev}') = 'null'::jsonb,
  '(e) conversion_from_prev(open) = NULL (primeiro degrau, sem anterior)');

-- ---------------------------------------------------------------------------
-- (f) Pipeline CUSTOM (type='custom') devolve REAIS, não zero (R3).
-- Roles NULL ≙ open: coorte=2, open=2, booked=held=won=0.
-- from_prev(booked)=0/2=0 (real); from_prev(held)=0/0=NULL (degrau vazio, mata #6).
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0002-000000000996','month','2027-07-15') ->> 'cohort_size')::int,
  2, '(f) funil CUSTOM tem coorte REAL (2), não zero — R3 morto');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0002-000000000996','month','2027-07-15') #>> '{steps,0,reached_count}')::int,
  2, '(f) CUSTOM reached(open)=2 (NULL ≙ open); custom é cidadão de 1a classe');
SELECT ok(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0002-000000000996','month','2027-07-15') #> '{steps,2,conversion_from_prev}') = 'null'::jsonb,
  '(f) CUSTOM degrau vazio (held, prev booked=0) → from_prev NULL, não 100');

-- ---------------------------------------------------------------------------
-- (g) Fronteira de coorte no tz da org: L8 entrou 31/07 23:30 -03.
-- Cai em JULHO local (dia 31); ausente de AGOSTO.
-- ---------------------------------------------------------------------------
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','day','2027-07-31') ->> 'cohort_size')::int,
  1, '(g) coorte do DIA 31/07 (tz org) = 1 (L8 entrou 23:30 local)');
SELECT is(
  (public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-08-15') ->> 'cohort_size')::int,
  0, '(g) L8 NÃO vaza pra agosto (corte no tz da org, não UTC)');

-- ---------------------------------------------------------------------------
-- (h) p_pipeline_id obrigatório.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996', NULL, 'month', '2027-07-15') $$,
  '22023', NULL,
  '(h) p_pipeline_id NULL é rejeitado (funil é por-pipeline)');

-- ---------------------------------------------------------------------------
-- (i) assert_org_access rejeita cross-org.
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99699699-aaaa-1111-0000-000000000996","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.get_funnel_flow('99699699-aaaa-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') $$,
  '(i) membro da org A lê o funil da própria org');

SELECT throws_ok(
  $$ SELECT public.get_funnel_flow('99699699-bbbb-0000-0000-000000000996','99699699-aaaa-4444-0001-000000000996','month','2027-07-15') $$,
  'P0001', NULL,
  '(i) membro da org A é BLOQUEADO na org B (assert_org_access)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
