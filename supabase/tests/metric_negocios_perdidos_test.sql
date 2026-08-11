-- supabase/tests/metric_negocios_perdidos_test.sql
--
-- SCRUM-311, fatia 5: `negocios_perdidos` — a metade que faltava de "ganho e
-- perda". A outra metade é `num_vendas`, que já existia.
--
-- O que esta suíte protege:
--
--   (RG) REGRESSÃO DA RECEITA. Esta migration reescreve `_metric_leaf`, que é
--        o caminho de `receita` e `num_vendas`. Se o ramo delas se perder na
--        reescrita, o dinheiro para de aparecer — e ninguém descobre até
--        alguém abrir a janela. É a asserção mais importante do arquivo.
--   (ES) a exclusão de estorno funciona, mesmo sendo inerte em prod hoje
--        (medido: zero estornos apontam para perda). O caso planta um para
--        provar que a cláusula não é decorativa.
--   (VL) contagem correta e (SR) séries.
--   (RC) recorte fora do conjunto levanta 22023.
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
  ('31160000-0000-4000-8000-00000000000a', 'Org NP A', 'org-np-a', 'America/Sao_Paulo'),
  ('31160000-0000-4000-8000-00000000000b', 'Org NP B', 'org-np-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3116115e-0000-4000-8000-00000000000a', 'user-3116a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3116115e-0000-4000-8000-00000000000b', 'user-3116b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31161ea9-0000-4000-8000-00000000000a', '31160000-0000-4000-8000-00000000000a',
   '3116115e-0000-4000-8000-00000000000a', 'Closer NP A', 'member', true),
  ('31161ea9-0000-4000-8000-00000000000b', '31160000-0000-4000-8000-00000000000b',
   '3116115e-0000-4000-8000-00000000000b', 'Closer NP B', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('31169ee1-0000-4000-8000-00000000000a', '31160000-0000-4000-8000-00000000000a', 'Propostas A', 'propostas', 'system'),
  ('31169ee1-0000-4000-8000-00000000000b', '31160000-0000-4000-8000-00000000000b', 'Propostas B', 'propostas', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, origin, created_at) VALUES
  ('3116ead1-0000-4000-8000-000000000001', '31160000-0000-4000-8000-00000000000a', 'Lead 1', 'meta_ads',  '2027-08-01T12:00:00Z'),
  ('3116ead1-0000-4000-8000-000000000002', '31160000-0000-4000-8000-00000000000a', 'Lead 2', 'meta_ads',  '2027-08-01T12:00:00Z'),
  ('3116ead1-0000-4000-8000-000000000003', '31160000-0000-4000-8000-00000000000a', 'Lead 3', 'indicacao', '2027-08-01T12:00:00Z'),
  ('3116ead1-0000-4000-8000-0000000000b1', '31160000-0000-4000-8000-00000000000b', 'Lead B', 'meta_ads',  '2027-08-01T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Org A na janela de agosto/2027:
--   3 perdas válidas (2 meta_ads, 1 indicacao)
--   1 perda ESTORNADA  → não conta
--   1 venda            → prova que `receita`/`num_vendas` seguem vivas
INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                sale_responsible_id, revenue_stream, pipeline_id, stage_key) VALUES
  ('3116e7e5-0000-4000-8000-000000000001', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000001', 'sale_lost', '2027-08-05T12:00:00Z', NULL, '31161ea9-0000-4000-8000-00000000000a', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido'),
  ('3116e7e5-0000-4000-8000-000000000002', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000002', 'sale_lost', '2027-08-06T12:00:00Z', NULL, '31161ea9-0000-4000-8000-00000000000a', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido'),
  ('3116e7e5-0000-4000-8000-000000000003', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000003', 'sale_lost', '2027-08-07T12:00:00Z', NULL, '31161ea9-0000-4000-8000-00000000000a', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido'),
  ('3116e7e5-0000-4000-8000-000000000004', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000001', 'sale_lost', '2027-08-08T12:00:00Z', NULL, '31161ea9-0000-4000-8000-00000000000a', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido'),
  ('3116e7e5-0000-4000-8000-000000000005', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000002', 'sale',      '2027-08-09T12:00:00Z', 1000, '31161ea9-0000-4000-8000-00000000000a', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido')
ON CONFLICT (id) DO NOTHING;

-- O estorno da quarta perda. Em prod isto não existe (zero estornos apontam
-- para perda); aqui existe justamente para provar que a cláusula não é enfeite.
INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                reversed_event_id, revenue_stream, pipeline_id, stage_key) VALUES
  ('3116e7e5-0000-4000-8000-00000000000f', '31160000-0000-4000-8000-00000000000a', '3116ead1-0000-4000-8000-000000000001', 'sale_reversed', '2027-08-08T13:00:00Z', NULL, '3116e7e5-0000-4000-8000-000000000004', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000a', 'perdido')
ON CONFLICT (id) DO NOTHING;

-- Org B: 1 perda. Só para provar que não vaza.
INSERT INTO public.sale_events (id, organization_id, lead_id, event_type, sold_at, sale_value,
                                sale_responsible_id, revenue_stream, pipeline_id, stage_key) VALUES
  ('3116e7e5-0000-4000-8000-0000000000b1', '31160000-0000-4000-8000-00000000000b', '3116ead1-0000-4000-8000-0000000000b1', 'sale_lost', '2027-08-05T12:00:00Z', NULL, '31161ea9-0000-4000-8000-00000000000b', 'novo_negocio', '31169ee1-0000-4000-8000-00000000000b', 'perdido')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) Catálogo e (GR) grants
-- ===========================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM public.metric_catalog_measures WHERE id = 'negocios_perdidos'),
  'CT1: medida registrada');

SELECT is(
  (SELECT anchor FROM public.metric_catalog_measures WHERE id = 'negocios_perdidos'),
  (SELECT anchor FROM public.metric_catalog_measures WHERE id = 'num_vendas'),
  'CT2: ancora igual a num_vendas — as duas metades de ganho/perda comparam a mesma janela');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.metric_catalog_measure_recortes
              WHERE measure_id = 'negocios_perdidos' AND recorte_id IN ('tag','produto','stream')),
  'CT3: não oferece tag, produto nem stream — fluxo de receita não classifica quem não gerou receita');

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa o leaf');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa o leaf');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_sales_lost(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa');

-- ===========================================================================
-- Como membro de A — o caminho real
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3116115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (VL) Valor e (ES) estorno
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  3::numeric, 'VL1: conta as 3 perdas e ignora a estornada');

SELECT is(
  public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'series',
  'null'::jsonb, 'VL2: recorte total devolve escalar, series null');

-- 4 perdas existem; 3 contam. Se a cláusula NOT EXISTS fosse decorativa, VL1
-- daria 4 — este caso é o que prova que ela age.
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id = '31160000-0000-4000-8000-00000000000a' AND event_type = 'sale_lost'),
  4, 'ES1: existem 4 perdas no fixture — VL1 conta 3, logo o estorno foi aplicado');

-- ===========================================================================
-- (RG) REGRESSÃO — receita e num_vendas seguem vivas após a reescrita
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"receita"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1000::numeric, 'RG1: receita continua somando — o ramo dela sobreviveu à reescrita');

SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"num_vendas"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric, 'RG2: num_vendas continua contando — a outra metade de ganho/perda');

SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  0::numeric, 'RG3: a família de qualidade também sobreviveu (0 avaliados neste fixture)');

-- ===========================================================================
-- (SR) Séries
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'origem', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) -> 'series' -> 0 ->> 'value')::numeric,
  2::numeric, 'SR1: por origem, meta_ads (2) vem primeiro — ordenação por valor desc');

SELECT is(
  jsonb_array_length(
    public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'closer', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date) -> 'series'),
  1, 'SR2: por closer, um único responsável no fixture');

SELECT is(
  public.fn_metric_measure('31160000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'origem', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'value',
  'null'::jsonb, 'SR3: com recorte, value vem null (value XOR series)');

-- ===========================================================================
-- (RC) Recorte fora do conjunto
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31160000-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'tag', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  '22023', NULL,
  'RC1: recorte não registrado levanta 22023');

-- ===========================================================================
-- (XO) Cross-org
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31160000-0000-4000-8000-00000000000b',
      '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'total', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B');

SELECT set_config('request.jwt.claims',
  '{"sub":"3116115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('31160000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"negocios_perdidos"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric, 'XO2: org B conta só a própria perda');

SELECT * FROM finish();
ROLLBACK;
