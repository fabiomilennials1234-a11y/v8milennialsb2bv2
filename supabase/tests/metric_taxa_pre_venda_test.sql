-- supabase/tests/metric_taxa_pre_venda_test.sql
--
-- SCRUM-422 — "vendas com pré-venda" e a taxa que sai dela.
--
-- O que esta suíte guarda:
--
--   (SN) pré-venda é o SNAPSHOT do evento, não a coluna do lead. Trocar o SDR
--        do lead DEPOIS da venda não pode mover o número — é o defeito que o
--        ADR-0017 §2 nomeia ao exigir snapshot.
--   (LE) a medida é LÍQUIDA de estorno, porque é a mesma função de num_vendas
--        com um predicado a mais. Se alguém escrever um leaf próprio aqui, este
--        caso é o primeiro a divergir.
--   (SB) numerador é SUBCONJUNTO do denominador: a taxa vive em [0,100] por
--        construção, sem trava.
--   (X1) a de SEIS argumentos não existe mais. Com as duas vivas, toda chamada
--        de seis casa com as duas e o Postgres recusa por ambiguidade.
--   (GR) a função é interna — anon e authenticated não a executam.
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
  ('42200000-0000-4000-8000-00000000000a', 'Org PV', 'org-pv-a', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('42201ea9-0000-4000-8000-00000000005d', '42200000-0000-4000-8000-00000000000a',
   NULL, 'SDR da casa', 'sdr', true),
  ('42201ea9-0000-4000-8000-00000000000c', '42200000-0000-4000-8000-00000000000a',
   NULL, 'Closer', 'closer', true)
ON CONFLICT (id) DO NOTHING;

-- O lead começa SEM SDR. A coluna dele é trocada mais adiante, de propósito.
INSERT INTO public.leads (id, organization_id, name, sdr_id) VALUES
  ('4220ead1-0000-4000-8000-00000000000a', '42200000-0000-4000-8000-00000000000a', 'Lead PV', NULL)
ON CONFLICT (id) DO NOTHING;

-- O CADERNO de julho/2027:
--   v1  COM pré-vendedor       conta nos dois
--   v2  SEM pré-vendedor       conta só no denominador
--   v3  COM pré-vendedor, ESTORNADA   não conta em lugar nenhum
--
--   num_vendas = 2 · com pré-venda = 1 · taxa = 50%
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, pre_sale_responsible_id, source) VALUES
 ('42200e40-0000-4000-8000-000000000001','42200000-0000-4000-8000-00000000000a','4220ead1-0000-4000-8000-00000000000a','42209191-0000-4000-8000-00000000000a','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio','42201ea9-0000-4000-8000-00000000000c','42201ea9-0000-4000-8000-00000000005d','backfill'),
 ('42200e40-0000-4000-8000-000000000002','42200000-0000-4000-8000-00000000000a','4220ead1-0000-4000-8000-00000000000a','42209191-0000-4000-8000-00000000000a','vendido','sale','2027-07-11 12:00-03',2000,'novo_negocio','42201ea9-0000-4000-8000-00000000000c',NULL,'backfill'),
 ('42200e40-0000-4000-8000-000000000003','42200000-0000-4000-8000-00000000000a','4220ead1-0000-4000-8000-00000000000a','42209191-0000-4000-8000-00000000000a','vendido','sale','2027-07-12 12:00-03',3000,'novo_negocio','42201ea9-0000-4000-8000-00000000000c','42201ea9-0000-4000-8000-00000000005d','backfill')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id,
   sold_at, sale_value, revenue_stream, sale_responsible_id, source) VALUES
 ('42200e40-0000-4000-8000-0000000000f3','42200000-0000-4000-8000-00000000000a','4220ead1-0000-4000-8000-00000000000a','42209191-0000-4000-8000-00000000000a','esfriou','sale_reversed','42200e40-0000-4000-8000-000000000003','2027-07-20 12:00-03',3000,'novo_negocio','42201ea9-0000-4000-8000-00000000000c','backfill')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (LE) líquida de estorno, e o denominador é o mesmo num_vendas
-- ===========================================================================
SELECT is(
  (public._metric_leaf_sales(
     '42200000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  2::numeric,
  '(LE) num_vendas = 2 — a estornada não conta');

SELECT is(
  (public._metric_leaf_sales(
     '42200000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, true) ->> 'value')::numeric,
  1::numeric,
  '(LE) com pré-venda = 1 — a estornada COM pré-vendedor também sai');

-- ===========================================================================
-- (SB) subconjunto: a taxa vive em [0,100] por construção
-- ===========================================================================
SELECT ok(
  (public._metric_leaf_sales(
     '42200000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, true) ->> 'value')::numeric
  <=
  (public._metric_leaf_sales(
     '42200000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  '(SB) o numerador nunca passa o denominador');

-- ===========================================================================
-- (SN) o SNAPSHOT manda — trocar o SDR do lead depois NÃO move o número
-- ===========================================================================
SET LOCAL session_replication_role = replica;
UPDATE public.leads
   SET sdr_id = '42201ea9-0000-4000-8000-00000000005d'
 WHERE id = '4220ead1-0000-4000-8000-00000000000a';
SET LOCAL session_replication_role = origin;

SELECT is(
  (public._metric_leaf_sales(
     '42200000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb, true) ->> 'value')::numeric,
  1::numeric,
  '(SN) pôr SDR no lead DEPOIS não transforma v2 em venda com pré-venda');

-- ===========================================================================
-- (X1) a de SEIS argumentos não existe mais
-- ===========================================================================
-- `to_regprocedure` casa a assinatura EXATA: ele não resolve default, ao
-- contrário do resolvedor de chamadas. Então a de seis tem que devolver NULL
-- (não existe mais) e a de sete tem que existir. Afirmar que a de seis
-- "resolve para" a de sete era pedir do catálogo uma resposta que só o
-- planejador dá.
SELECT ok(
  to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)') IS NULL,
  '(X1) a de SEIS argumentos não existe mais — com as duas vivas, toda chamada de 6 seria ambígua');

SELECT ok(
  to_regprocedure('public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)') IS NOT NULL,
  '(X1) e a de SETE existe');

-- ===========================================================================
-- (CT) catálogo: a medida existe e herdou os recortes de num_vendas
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_measures WHERE id = 'num_vendas_pre_venda'),
  1, '(CT) a medida está no catálogo');

SELECT is(
  (SELECT array_agg(recorte_id ORDER BY recorte_id) FROM public.metric_catalog_measure_recortes
    WHERE measure_id = 'num_vendas_pre_venda'),
  (SELECT array_agg(recorte_id ORDER BY recorte_id) FROM public.metric_catalog_measure_recortes
    WHERE measure_id = 'num_vendas'),
  '(CT) os recortes são exatamente os de num_vendas');

-- ===========================================================================
-- (GR) a função é interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa — sem isso o motor não roda');

SELECT * FROM finish();
ROLLBACK;
