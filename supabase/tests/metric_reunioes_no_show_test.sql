-- supabase/tests/metric_reunioes_no_show_test.sql
--
-- SCRUM-311, fatia 8: `reunioes_no_show` + a volta do `target`, reconciliados
-- no despachante ATUAL.
--
-- O que esta suíte protege:
--
--   (OR) ÓRFÃ NO CATÁLOGO. Toda medida catalogada tem de ter ramo no `CASE` do
--        despachante. É A asserção desta fatia: foi exatamente essa checagem que
--        faltou em `20260727140000` — ela catalogou `reunioes_no_show` num corpo
--        de `_metric_leaf` que as fatias seguintes iam sobrescrever, e o defeito
--        só apareceria quando um cliente abrisse a janela.
--   (CL) CLAMP. `held` sem `booked` é ruído de dado, nunca no-show negativo.
--   (AL) ALVO. `target` vem de `goals` pela org + MÊS DO BOUNDS, e é null quando
--        a medida não tem `goal_type` ou quando o mês não bate.
--   (RG) REGRESSÃO DA RECEITA. Esta migration reescreve o despachante — o mesmo
--        caminho por onde passa o dinheiro. `receita` e `num_vendas` são
--        conferidos por número, não por existência.
--   (GR) zero EXECUTE para anon e authenticated nas funções internas.
--   (XO) isolamento cross-org nas duas metades.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('31190000-0000-4000-8000-00000000000a', 'Org NS A', 'org-ns-a', 'America/Sao_Paulo'),
  ('31190000-0000-4000-8000-00000000000b', 'Org NS B', 'org-ns-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3119115e-0000-4000-8000-00000000000a', 'user-3119a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3119115e-0000-4000-8000-00000000000b', 'user-3119b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31191ea9-0000-4000-8000-00000000000a', '31190000-0000-4000-8000-00000000000a',
   '3119115e-0000-4000-8000-00000000000a', 'SDR NS A', 'member', true),
  ('31191ea9-0000-4000-8000-00000000000b', '31190000-0000-4000-8000-00000000000b',
   '3119115e-0000-4000-8000-00000000000b', 'SDR NS B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at) VALUES
  ('3119ead1-0000-4000-8000-000000000001', '31190000-0000-4000-8000-00000000000a', 'Lead NS 1', 'meta_ads',  '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3119ead1-0000-4000-8000-000000000002', '31190000-0000-4000-8000-00000000000a', 'Lead NS 2', 'indicacao', '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z'),
  ('3119ead1-0000-4000-8000-0000000000b1', '31190000-0000-4000-8000-00000000000b', 'Lead NS B', 'meta_ads',  '2027-08-01T12:00:00Z', '2027-08-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- AGOSTO/2027, Org A: 5 marcadas × 2 comparecidas → no-show = 3.
-- SETEMBRO/2027, Org A: 1 marcada × 3 comparecidas → clamp em 0, NÃO -2.
INSERT INTO public.meeting_events (id, organization_id, lead_id, event_type, occurred_at, meeting_date, pre_sale_responsible_id) VALUES
  ('3119e0e0-0000-4000-8000-000000000001', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_booked', '2027-08-03T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000002', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_booked', '2027-08-04T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000003', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000002', 'meeting_booked', '2027-08-05T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000004', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000002', 'meeting_booked', '2027-08-06T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000005', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_booked', '2027-08-07T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000006', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_held',   '2027-08-08T12:00:00Z', '2027-08-08T15:00:00Z', '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000007', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000002', 'meeting_held',   '2027-08-09T12:00:00Z', '2027-08-09T15:00:00Z', '31191ea9-0000-4000-8000-00000000000a'),
  -- setembro: mais comparecidas do que marcadas
  ('3119e0e0-0000-4000-8000-000000000011', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_booked', '2027-09-03T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000012', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_held',   '2027-09-04T12:00:00Z', '2027-09-04T15:00:00Z', '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000013', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000001', 'meeting_held',   '2027-09-05T12:00:00Z', '2027-09-05T15:00:00Z', '31191ea9-0000-4000-8000-00000000000a'),
  ('3119e0e0-0000-4000-8000-000000000014', '31190000-0000-4000-8000-00000000000a', '3119ead1-0000-4000-8000-000000000002', 'meeting_held',   '2027-09-06T12:00:00Z', '2027-09-06T15:00:00Z', '31191ea9-0000-4000-8000-00000000000a'),
  -- org B: 1 marcada, nenhuma comparecida
  ('3119e0e0-0000-4000-8000-0000000000b1', '31190000-0000-4000-8000-00000000000b', '3119ead1-0000-4000-8000-0000000000b1', 'meeting_booked', '2027-08-03T12:00:00Z', NULL, '31191ea9-0000-4000-8000-00000000000b')
ON CONFLICT (id) DO NOTHING;

-- Meta de AGOSTO/2027 para reunioes_marcadas, org-level (team_member_id NULL).
-- `name` é NOT NULL em goals — omitir derruba a suíte na primeira inserção.
INSERT INTO public.goals (id, organization_id, name, type, target_value, month, year, team_member_id) VALUES
  ('3119604a-0000-4000-8000-000000000001', '31190000-0000-4000-8000-00000000000a',
   'Reuniões marcadas AGO', 'reunioes_marcadas', 10, 8, 2027, NULL)
ON CONFLICT (id) DO NOTHING;

-- Uma venda, só para a regressão do caminho da receita. `revenue_stream` é
-- obrigatório e, com producer='funnel', o CHECK exige pipeline_id + stage_key.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at, sale_value,
   currency, revenue_stream, sale_responsible_id, source, producer) VALUES
  ('31195a1e-0000-4000-8000-000000000001', '31190000-0000-4000-8000-00000000000a',
   '3119ead1-0000-4000-8000-000000000001', '31190000-0000-4000-8000-000000000401', 'vendido',
   'sale', '2027-08-10T12:00:00Z', 1000, 'BRL', 'novo_negocio',
   '31191ea9-0000-4000-8000-00000000000a', 'backfill', 'funnel')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) Catálogo
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_measures WHERE id = 'reunioes_no_show'),
  1, 'CT1: a medida está no catálogo');

SELECT set_eq(
  $$SELECT recorte_id FROM public.metric_catalog_measure_recortes
     WHERE measure_id = 'reunioes_no_show'$$,
  $$VALUES ('total'),('sdr'),('origem'),('tempo')$$,
  'CT2: os quatro recortes, e só eles');

-- ===========================================================================
-- (OR) A asserção que motiva a fatia inteira
-- ===========================================================================
-- Medida catalogada sem ramo no despachante levanta 22023 na primeira abertura
-- da janela — em produção, na frente do cliente. Aqui reprova no CI.
SELECT is(
  (SELECT string_agg(m.id, ', ' ORDER BY m.id)
     FROM public.metric_catalog_measures m
    WHERE position('''' || m.id || '''' IN
          (SELECT p.prosrc FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = '_metric_leaf' AND p.pronargs = 8)) = 0),
  NULL,
  'OR1: nenhuma medida catalogada ficou órfã de ramo no despachante');

-- ===========================================================================
-- (GR) Grants
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa o leaf de no-show');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa o leaf de no-show');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa — senão o motor não roda');

SELECT ok(
  (SELECT prosrc !~* '(^|[^_[:alnum:]])execute[[:space:]]'
     FROM pg_proc WHERE proname = '_metric_leaf_no_show'),
  'GR4: o leaf não tem EXECUTE dinâmico');

-- ===========================================================================
-- Daqui em diante como MEMBRO DE A — o caminho real do navegador
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3119115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (VL) Valores
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  3::numeric, 'VL1: 5 marcadas − 2 comparecidas = 3');

SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_marcadas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  5::numeric, 'VL2: controle — marcadas = 5');

SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_realizadas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  2::numeric, 'VL3: controle — comparecidas = 2');

-- ===========================================================================
-- (CL) Clamp
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'total', 'range', NULL,
     '2027-09-01'::date, '2027-09-30'::date) ->> 'value')::numeric,
  0::numeric, 'CL1: 1 marcada − 3 comparecidas = 0, não −2');

-- ===========================================================================
-- (SR) value XOR series
-- ===========================================================================
SELECT is(
  public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'origem', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'value',
  'null'::jsonb, 'SR1: com recorte, value vem null');

SELECT ok(
  jsonb_typeof(public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'origem', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'series') = 'array',
  'SR2: recorte origem devolve série');

-- ===========================================================================
-- (AL) O alvo
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_marcadas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'target')::numeric,
  10::numeric, 'AL1: target vem de goals pelo goal_type da medida');

SELECT ok(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_marcadas"}'::jsonb, 'total', 'range', NULL,
     '2027-09-01'::date, '2027-09-30'::date) ->> 'target') IS NULL,
  'AL2: a meta é de agosto — em setembro o alvo é ausência, não zero');

SELECT ok(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'target') IS NULL,
  'AL3: medida sem goal_type não inventa alvo');

-- ===========================================================================
-- (RG) Regressão do caminho da receita — esta migration reescreve o despachante
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"receita"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1000::numeric, 'RG1: receita segue somando pelo caderno');

SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"num_vendas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric, 'RG2: num_vendas segue contando');

SELECT is(
  public.fn_metric_measure('31190000-0000-4000-8000-00000000000a',
    '{"kind":"ratio","num":"receita","den":"num_vendas"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) ->> 'unit',
  'currency', 'RG3: a razão do ticket médio segue derivando currency');

-- ===========================================================================
-- (XO) Isolamento cross-org
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31190000-0000-4000-8000-00000000000b',
      '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'total', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B (assert_org_access)');

SELECT set_config('request.jwt.claims',
  '{"sub":"3119115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"reunioes_no_show"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric, 'XO2: org B conta só a própria — as 5 da A não vazam');

SELECT ok(
  (public.fn_metric_measure('31190000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"reunioes_marcadas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'target') IS NULL,
  'XO3: a meta da org A não vaza como alvo da org B');

SELECT * FROM finish();
ROLLBACK;
