-- supabase/tests/metric_ltv_test.sql
--
-- SCRUM-417 — LTV = receita realizada por cliente, 12 meses.
--
-- O que esta suíte guarda:
--
--   (JA) a JANELA é própria e ancorada no FIM do período. Ancorar no início
--        faria "este mês" olhar 12 meses atrás do dia 1º e ignorar o próprio
--        mês — o cliente que comprou ontem sumiria da conta.
--   (CP) o numerador É `receita` — a mesma função de Faturamento, não uma
--        segunda soma. Provado pelo número, comparando com `_metric_leaf_sales`
--        na mesma janela.
--   (LE) venda estornada sai dos DOIS lados: da receita e da contagem de
--        clientes. Cliente cuja única venda foi estornada não é cliente.
--   (DE) o denominador é DISTINCT de lead: quem comprou três vezes é um
--        cliente, não três.
--   (D0) zero cliente é AUSÊNCIA, não R$ 0,00 — "zero de LTV" afirmaria que os
--        clientes não compraram.
--   (RE) recorte fora de `total` levanta 22023.
--   (GR) a função é interna.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('41700000-0000-4000-8000-00000000000a', 'Org LTV', 'org-ltv-a', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('4170ead1-0000-4000-8000-000000000001', '41700000-0000-4000-8000-00000000000a', 'Cliente A'),
  ('4170ead1-0000-4000-8000-000000000002', '41700000-0000-4000-8000-00000000000a', 'Cliente B'),
  ('4170ead1-0000-4000-8000-000000000003', '41700000-0000-4000-8000-00000000000a', 'Cliente C (só estorno)'),
  ('4170ead1-0000-4000-8000-000000000004', '41700000-0000-4000-8000-00000000000a', 'Cliente D (13 meses atrás)')
ON CONFLICT (id) DO NOTHING;

-- O CADERNO. A janela de referência dos testes termina em 2027-09-01, então os
-- 12 meses vão de 2026-09-01 a 2027-09-01.
--
--   A: 1000 (07/2027) + 500 (03/2027)   → 1 cliente, 1500
--   B: 700  (11/2026)                   → 1 cliente, 700
--   C: 9000 (06/2027) ESTORNADA         → não é cliente, não é receita
--   D: 4000 (08/2026) FORA da janela    → não entra
--
--   receita na janela = 2200 · clientes = 2 · LTV = 1100,00
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, revenue_stream, sale_responsible_id, source) VALUES
 ('41700e40-0000-4000-8000-000000000001','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000001','41709191-0000-4000-8000-00000000000a','vendido','sale','2027-07-10 12:00-03',1000,'novo_negocio',NULL,'backfill'),
 ('41700e40-0000-4000-8000-000000000002','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000001','41709191-0000-4000-8000-00000000000a','vendido','sale','2027-03-10 12:00-03',500,'novo_negocio',NULL,'backfill'),
 ('41700e40-0000-4000-8000-000000000003','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000002','41709191-0000-4000-8000-00000000000a','vendido','sale','2026-11-10 12:00-03',700,'novo_negocio',NULL,'backfill'),
 ('41700e40-0000-4000-8000-000000000004','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000003','41709191-0000-4000-8000-00000000000a','vendido','sale','2027-06-10 12:00-03',9000,'novo_negocio',NULL,'backfill'),
 ('41700e40-0000-4000-8000-000000000005','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000004','41709191-0000-4000-8000-00000000000a','vendido','sale','2026-08-10 12:00-03',4000,'novo_negocio',NULL,'backfill')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, reversed_event_id,
   sold_at, sale_value, revenue_stream, sale_responsible_id, source) VALUES
 ('41700e40-0000-4000-8000-0000000000f4','41700000-0000-4000-8000-00000000000a','4170ead1-0000-4000-8000-000000000003','41709191-0000-4000-8000-00000000000a','esfriou','sale_reversed','41700e40-0000-4000-8000-000000000004','2027-06-20 12:00-03',9000,'novo_negocio',NULL,'backfill')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (JA) + (LE) + (DE): o número inteiro
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ltv(
     '41700000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-08-01T00:00:00-03', '2027-09-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  1100.00::numeric,
  '(JA/LE/DE) 2200 de receita ÷ 2 clientes — estorno fora, 13 meses atrás fora');

-- ===========================================================================
-- (CP) o numerador É a receita da mesma função
-- ===========================================================================
SELECT is(
  (public._metric_leaf_sales(
     '41700000-0000-4000-8000-00000000000a', 'revenue', 'total',
     tstzrange('2026-09-01T00:00:00-03', '2027-09-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  2200::numeric,
  '(CP) a receita da janela de 12 meses, pela função de Faturamento, é 2200');

-- ===========================================================================
-- (JA) mudar o PERÍODO desloca a janela, e o número muda com ela
-- ===========================================================================
-- Período que termina em 2027-04-01: a janela vira 2026-04-01→2027-04-01.
--   A: só os 500 de março · B: 700 · D: 4000 (agora DENTRO)
--   receita = 5200 · clientes = 3 · LTV = 1733,33
SELECT is(
  (public._metric_leaf_ltv(
     '41700000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2027-03-01T00:00:00-03', '2027-04-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'value')::numeric,
  1733.33::numeric,
  '(JA) a janela acompanha o FIM do período — 12 meses antes dele, não do começo');

-- ===========================================================================
-- (D0) sem cliente na janela é ausência, não zero
-- ===========================================================================
SELECT is(
  (public._metric_leaf_ltv(
     '41700000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2025-01-01T00:00:00-03', '2025-02-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'empty_reason'),
  'no_rows', '(D0) janela sem cliente devolve ausência');

SELECT ok(
  (public._metric_leaf_ltv(
     '41700000-0000-4000-8000-00000000000a', 'total',
     tstzrange('2025-01-01T00:00:00-03', '2025-02-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) -> 'value') = 'null'::jsonb,
  '(D0) e o valor é nulo, não R$ 0,00');

-- ===========================================================================
-- (RE) recorte fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_ltv(
       '41700000-0000-4000-8000-00000000000a', 'origem',
       tstzrange('2027-08-01T00:00:00-03', '2027-09-01T00:00:00-03', '[)'),
       'America/Sao_Paulo', '{}'::jsonb) $$,
  '22023', NULL,
  '(RE) recorte fora de total levanta 22023');

-- ===========================================================================
-- (CT) catálogo
-- ===========================================================================
SELECT is(
  (SELECT array_agg(recorte_id) FROM public.metric_catalog_measure_recortes WHERE measure_id = 'ltv'),
  ARRAY['total']::text[], '(CT) o único recorte declarado é total');

SELECT is(
  (SELECT unit FROM public.metric_catalog_measures WHERE id = 'ltv'),
  'currency', '(CT) a unidade é moeda');

-- ===========================================================================
-- (GR) interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) authenticated não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa');

SELECT * FROM finish();
ROLLBACK;
