-- supabase/tests/metric_qualidade_lead_test.sql
--
-- SCRUM-311, fatias 2-4: a família de qualidade de lead no catálogo fechado.
--   leads_avaliados · leads_nao_avaliados · boas_avaliacoes
--
-- O que esta suíte protege, além do número:
--
--   (ID) a IDENTIDADE. avaliados + nao_avaliados = leads_criados, e
--        bons ≤ avaliados ≤ leads_criados. É o motivo de as três compartilharem
--        coorte e leaf; sem isto elas viram três contagens que não conversam.
--   (CR) o critério é conjunto FECHADO. Valor fora dos três levanta erro em vez
--        de devolver a coorte inteira como se fosse a fatia — falha silenciosa
--        que dá número maior, plausível e errado.
--   (TI) desqualificado É avaliado. Confundir isso incha `nao_avaliados` com
--        leads que a operação já julgou.
--   (GR) zero EXECUTE para anon e authenticated nas funções internas.
--   (XO) isolamento cross-org nas duas metades: autorização e filtro.
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
  ('31140000-0000-4000-8000-00000000000a', 'Org QL A', 'org-ql-a', 'America/Sao_Paulo'),
  ('31140000-0000-4000-8000-00000000000b', 'Org QL B', 'org-ql-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- `fn_metric_measure` chama `assert_org_access`, que exige membro ATIVO da org.
-- Sem estes usuários a suíte morre em access_denied na primeira chamada.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3114115e-0000-4000-8000-00000000000a', 'user-3114a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('3114115e-0000-4000-8000-00000000000b', 'user-3114b@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 'member', não 'membro': o enum app_role é admin/sdr/closer/agency/bdr/
-- cliente/member. 'membro' derrubava dez suítes na primeira inserção.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('31141ea9-0000-4000-8000-00000000000a', '31140000-0000-4000-8000-00000000000a',
   '3114115e-0000-4000-8000-00000000000a', 'Membro QL A', 'member', true),
  ('31141ea9-0000-4000-8000-00000000000b', '31140000-0000-4000-8000-00000000000b',
   '3114115e-0000-4000-8000-00000000000b', 'Membro QL B', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- Org A, todos com metrics_period_at dentro de agosto/2027:
--   2 diamante + 1 prata          → bons = 3
--   1 bronze + 1 desqualificado   → avaliados sobe, bons NÃO
--   3 sem tier                    → nao_avaliados = 3
--   1 apagado (não conta em nada)
-- Logo: criados = 8, avaliados = 5, nao_avaliados = 3, bons = 3.
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at,
                          deleted_at, qualification_tier, pre_qualification_tier) VALUES
  ('3114ead1-0000-4000-8000-000000000001', '31140000-0000-4000-8000-00000000000a', 'Diamante 1', 'meta_ads',  '2027-08-10T12:00:00Z', '2027-08-10T12:00:00Z', NULL, 'diamante', NULL),
  ('3114ead1-0000-4000-8000-000000000002', '31140000-0000-4000-8000-00000000000a', 'Diamante 2', 'meta_ads',  '2027-08-11T12:00:00Z', '2027-08-11T12:00:00Z', NULL, 'diamante', NULL),
  -- só pré-qualificado: o COALESCE tem de pegar este como avaliado
  ('3114ead1-0000-4000-8000-000000000003', '31140000-0000-4000-8000-00000000000a', 'Prata pre',  'indicacao', '2027-08-12T12:00:00Z', '2027-08-12T12:00:00Z', NULL, NULL, 'prata'),
  ('3114ead1-0000-4000-8000-000000000004', '31140000-0000-4000-8000-00000000000a', 'Bronze',     'meta_ads',  '2027-08-13T12:00:00Z', '2027-08-13T12:00:00Z', NULL, 'bronze', NULL),
  ('3114ead1-0000-4000-8000-000000000005', '31140000-0000-4000-8000-00000000000a', 'Desqual',    'indicacao', '2027-08-14T12:00:00Z', '2027-08-14T12:00:00Z', NULL, 'desqualificado', NULL),
  ('3114ead1-0000-4000-8000-000000000006', '31140000-0000-4000-8000-00000000000a', 'Cru 1',      'meta_ads',  '2027-08-15T12:00:00Z', '2027-08-15T12:00:00Z', NULL, NULL, NULL),
  ('3114ead1-0000-4000-8000-000000000007', '31140000-0000-4000-8000-00000000000a', 'Cru 2',      'meta_ads',  '2027-08-16T12:00:00Z', '2027-08-16T12:00:00Z', NULL, NULL, NULL),
  ('3114ead1-0000-4000-8000-000000000008', '31140000-0000-4000-8000-00000000000a', 'Cru 3',      'indicacao', '2027-08-17T12:00:00Z', '2027-08-17T12:00:00Z', NULL, NULL, NULL),
  ('3114ead1-0000-4000-8000-000000000009', '31140000-0000-4000-8000-00000000000a', 'Apagado',    'meta_ads',  '2027-08-18T12:00:00Z', '2027-08-18T12:00:00Z', now(), 'ouro', NULL)
ON CONFLICT (id) DO NOTHING;

-- Org B: 1 ouro. Existe só para provar que não vaza para a contagem da A.
INSERT INTO public.leads (id, organization_id, name, origin, created_at, metrics_period_at,
                          deleted_at, qualification_tier, pre_qualification_tier) VALUES
  ('3114ead1-0000-4000-8000-0000000000b1', '31140000-0000-4000-8000-00000000000b', 'Ouro B', 'meta_ads', '2027-08-10T12:00:00Z', '2027-08-10T12:00:00Z', NULL, 'ouro', NULL)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (CT) Catálogo
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_measures
    WHERE id IN ('leads_avaliados', 'leads_nao_avaliados', 'boas_avaliacoes')),
  3, 'CT1: as três medidas da família estão no catálogo');

SELECT is(
  (SELECT count(DISTINCT anchor)::int FROM public.metric_catalog_measures
    WHERE id IN ('leads_avaliados', 'leads_nao_avaliados', 'boas_avaliacoes', 'leads_criados')),
  1, 'CT2: a família ancora igual a leads_criados — senão a soma compara janelas diferentes');

SELECT set_eq(
  $$SELECT recorte_id FROM public.metric_catalog_measure_recortes
     WHERE measure_id = 'leads_avaliados'$$,
  $$SELECT recorte_id FROM public.metric_catalog_measure_recortes
     WHERE measure_id = 'leads_criados'$$,
  'CT3: os recortes são os mesmos da base — derivada não corta menos que a base');

-- ===========================================================================
-- (ZE) Zero EXECUTE dinâmico e (GR) grants
-- ===========================================================================
SELECT ok(
  (SELECT prosrc !~* '(^|[^_[:alnum:]])execute[[:space:]]'
     FROM pg_proc WHERE proname = '_metric_leaf_leads_qualidade'),
  'ZE1: o leaf da família não tem EXECUTE dinâmico');

SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public']
     FROM pg_proc WHERE proname = '_metric_leaf_leads_qualidade'),
  'ZE2: SECURITY DEFINER com search_path pinado');

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa o leaf da família');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated NÃO executa o leaf da família');

SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_qualidade_casa(public.qualification_tier, text)'::regprocedure, 'EXECUTE'),
  'GR3: anon NÃO executa o predicado');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_leads_qualidade(uuid, text, tstzrange, text, jsonb, text)'::regprocedure, 'EXECUTE'),
  'GR4: service_role executa — senão o motor não roda');

-- ===========================================================================
-- (CR) O critério é conjunto fechado
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public._metric_leaf_leads_qualidade(
      '31140000-0000-4000-8000-00000000000a', 'total',
      tstzrange('2027-08-01', '2027-09-01'), 'America/Sao_Paulo', '{}'::jsonb, 'inventado')$$,
  '22023', NULL,
  'CR1: critério fora dos três levanta 22023 — não devolve a coorte inteira');

-- ===========================================================================
-- Daqui em diante como MEMBRO DE A — o caminho real do navegador
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3114115e-0000-4000-8000-00000000000a","role":"authenticated"}', true);

-- ===========================================================================
-- (VL) Valores
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  5::numeric, 'VL1: avaliados = 5 (inclui bronze, desqualificado e o só-pré)');

SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_nao_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  3::numeric, 'VL2: não avaliados = 3');

SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  3::numeric, 'VL3: bons = 3 (2 diamante + 1 prata; bronze e desqualificado fora)');

-- ===========================================================================
-- (TI) Desqualificado é avaliado
-- ===========================================================================
-- Se `nao_avaliados` contasse desqualificado, daria 4 e não 3. O caso existe
-- porque a leitura ingênua de "não avaliado" inclui quem foi reprovado.
SELECT ok(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_nao_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric = 3,
  'TI1: desqualificado NÃO entra em não avaliados — é um tier, logo foi avaliado');

-- ===========================================================================
-- (ID) A identidade que justifica a coorte compartilhada
-- ===========================================================================
SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric
  +
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_nao_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_criados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  'ID1: avaliados + nao_avaliados = leads_criados');

SELECT ok(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric
  <=
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  'ID2: bons ⊆ avaliados');

-- ===========================================================================
-- (SR) Séries e o contrato value XOR series
-- ===========================================================================
SELECT is(
  public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'origem', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'value',
  'null'::jsonb, 'SR1: com recorte, value vem null');

SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
     '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'origem', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) -> 'series' -> 0 ->> 'value')::numeric,
  2::numeric, 'SR2: série ordenada por valor desc — meta_ads (2 diamantes) primeiro');

SELECT is(
  public.fn_metric_measure('31140000-0000-4000-8000-00000000000a',
    '{"kind":"leaf","id":"leads_avaliados"}'::jsonb, 'total', 'range', NULL,
    '2027-08-01'::date, '2027-08-31'::date) -> 'series',
  'null'::jsonb, 'SR3: recorte total devolve escalar, series null');

-- ===========================================================================
-- (RC) Recorte incompatível
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31140000-0000-4000-8000-00000000000a',
      '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'closer', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  '22023', NULL,
  'RC1: corte por pessoa levanta 22023 — não devolve número errado');

-- ===========================================================================
-- (XO) Isolamento cross-org, as duas metades
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.fn_metric_measure(
      '31140000-0000-4000-8000-00000000000b',
      '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'total', 'range', NULL,
      '2027-08-01'::date, '2027-08-31'::date)$$,
  'P0001', NULL,
  'XO1: membro de A é BLOQUEADO na org B (assert_org_access)');

SELECT set_config('request.jwt.claims',
  '{"sub":"3114115e-0000-4000-8000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (public.fn_metric_measure('31140000-0000-4000-8000-00000000000b',
     '{"kind":"leaf","id":"boas_avaliacoes"}'::jsonb, 'total', 'range', NULL,
     '2027-08-01'::date, '2027-08-31'::date) ->> 'value')::numeric,
  1::numeric, 'XO2: org B conta só o próprio — os 3 da A não vazam');

SELECT * FROM finish();
ROLLBACK;
