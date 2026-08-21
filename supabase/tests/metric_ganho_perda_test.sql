-- supabase/tests/metric_ganho_perda_test.sql
--
-- SCRUM-391 — "Ganho e perda" no catálogo do motor.
--
-- O que esta suíte guarda:
--
--   (CP) a medida COMPÕE `_metric_leaf_sales` e `_metric_leaf_sales_lost` em vez
--        de recontar. Provado pelo número, não pela leitura: o balde de ganhos
--        bate com `num_vendas` e o de perdas com `negocios_perdidos`, na mesma
--        janela e com o mesmo filtro. Se alguém reescrever o predicado aqui, um
--        dos dois diverge.
--   (LE) ganhos são LÍQUIDOS de estorno — a venda estornada não conta, porque a
--        função de origem já a tira.
--   (RE) o recorte é FECHADO: qualquer coisa fora de `desfecho` levanta 22023.
--        Devolver a série de desfecho para um pedido de `origem` seria responder
--        outra pergunta com cara de resposta.
--   (NT) a medida NÃO oferece `total` no catálogo. Somar ganho com perda dá um
--        número que não responde pergunta nenhuma.
--   (D0) janela sem venda E sem perda é AUSÊNCIA (`empty_reason`), não dois
--        zeros. Mas UM zero ao lado de um número é RESPOSTA e tem que aparecer.
--   (XO) isolamento cross-org.
--   (GR) a função é INTERNA — anon e authenticated não a executam.
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
  ('39100000-0000-4000-8000-00000000000a', 'Org GP A', 'org-gp-a', 'America/Sao_Paulo'),
  ('39100000-0000-4000-8000-00000000000b', 'Org GP B', 'org-gp-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('3910ead1-0000-4000-8000-00000000000a', '39100000-0000-4000-8000-00000000000a', 'Lead GP A'),
  ('3910ead1-0000-4000-8000-00000000000b', '39100000-0000-4000-8000-00000000000b', 'Lead GP B')
ON CONFLICT (id) DO NOTHING;

-- O CADERNO da org A, julho/2027:
--   v1  venda 1000  10/07              conta
--   v2  venda 2000  11/07  ESTORNADA   NÃO conta (LE)
--   v3  venda  500  12/07              conta
--   p1  sale_lost         13/07        conta como perda
--   p2  sale_lost         14/07        conta como perda
--   p3  sale_lost         15/07        conta como perda
--
--   ganhos = 2 · perdas = 3
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source) VALUES
 ('39100e40-0000-4000-8000-000000000001','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio',NULL,'backfill'),
 ('39100e40-0000-4000-8000-000000000002','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','vendido','sale','2027-07-11 12:00-03',2000,'novo_negocio',NULL,'backfill'),
 ('39100e40-0000-4000-8000-000000000003','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','vendido','sale','2027-07-12 12:00-03',500,'novo_negocio',NULL,'backfill'),
 ('39100e40-0000-4000-8000-000000000011','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','perdido','sale_lost','2027-07-13 12:00-03',NULL,'novo_negocio',NULL,'backfill'),
 ('39100e40-0000-4000-8000-000000000012','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','perdido','sale_lost','2027-07-14 12:00-03',NULL,'novo_negocio',NULL,'backfill'),
 ('39100e40-0000-4000-8000-000000000013','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','perdido','sale_lost','2027-07-15 12:00-03',NULL,'novo_negocio',NULL,'backfill'),
 -- Org B: uma venda, para provar o isolamento.
 ('39100e40-0000-4000-8000-0000000000b1','39100000-0000-4000-8000-00000000000b','3910ead1-0000-4000-8000-00000000000b','39109191-0000-4000-8000-00000000000b','vendido','sale','2027-07-10 12:00-03',9999,'novo_negocio',NULL,'backfill')
ON CONFLICT (id) DO NOTHING;

-- Estorno de v2.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id,
   sold_at, sale_value, revenue_stream, sale_responsible_id, source) VALUES
 ('39100e40-0000-4000-8000-0000000000f2','39100000-0000-4000-8000-00000000000a','3910ead1-0000-4000-8000-00000000000a','39109191-0000-4000-8000-00000000000a','esfriou','sale_reversed','39100e40-0000-4000-8000-000000000002','2027-07-20 12:00-03',2000,'novo_negocio',NULL,'backfill')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (CP) COMPOSIÇÃO — os baldes batem com as medidas de origem
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 0 ->> 'value')::numeric,
  (public._metric_leaf_sales(
     '39100000-0000-4000-8000-00000000000a', 'count', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  '(CP) o balde de ganhos É num_vendas — mesma função, não outra conta');

SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 1 ->> 'value')::numeric,
  (public._metric_leaf_sales_lost(
     '39100000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  '(CP) o balde de perdas É negocios_perdidos');

-- ===========================================================================
-- (LE) ganhos líquidos de estorno, e os rótulos
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 0 ->> 'value')::numeric,
  2::numeric,
  '(LE) ganhos = 2 de 3 vendas — a estornada não conta');

SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 1 ->> 'value')::numeric,
  3::numeric,
  '(LE) perdas = 3');

SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 0 ->> 'label'),
  'Ganhos', '(LE) o primeiro balde é rotulado, não é chave crua');

-- ===========================================================================
-- (RE) recorte fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_ganho_perda(
       '39100000-0000-4000-8000-00000000000a', 'origem',
       tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
       'America/Sao_Paulo', '{}'::jsonb) $$,
  '22023', NULL,
  '(RE) recorte fora de desfecho levanta 22023 em vez de responder outra coisa');

-- ===========================================================================
-- (NT) o catálogo NÃO oferece total
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_measure_recortes
    WHERE measure_id = 'ganho_perda' AND recorte_id = 'total'),
  0, '(NT) ganho_perda não declara o recorte total');

SELECT is(
  (SELECT array_agg(recorte_id ORDER BY recorte_id) FROM public.metric_catalog_measure_recortes
    WHERE measure_id = 'ganho_perda'),
  ARRAY['desfecho']::text[],
  '(NT) o único recorte declarado é desfecho');

-- ===========================================================================
-- (D0) ausência × zero
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000a', 'desfecho',
     tstzrange('2027-01-01T00:00:00-03', '2027-02-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'empty_reason'),
  'no_rows', '(D0) janela sem venda e sem perda é ausência, não dois zeros');

-- Org B só tem venda: o balde de perdas é ZERO e PRECISA aparecer — "nenhuma
-- perda no mês" é informação, e some se o balde não for desenhado.
SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000b', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 1 ->> 'value')::numeric,
  0::numeric, '(D0) zero ao lado de número é resposta — o balde vazio aparece');

-- ===========================================================================
-- (XO) isolamento
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ganho_perda(
     '39100000-0000-4000-8000-00000000000b', 'desfecho',
     tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'series' -> 0 ->> 'value')::numeric,
  1::numeric, '(XO) a org B enxerga só a venda dela');

-- ===========================================================================
-- (GR) a função é interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa — sem isso o motor não roda');

SELECT * FROM finish();
ROLLBACK;
