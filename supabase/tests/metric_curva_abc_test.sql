-- supabase/tests/metric_curva_abc_test.sql
--
-- SCRUM-418 — curva ABC de produtos, régua 80/15/5 por receita acumulada.
--
-- O que esta suíte guarda:
--
--   (FR) a FRONTEIRA. O corte é pelo acumulado APÓS incluir o produto: quem
--        cruza os 80% ainda é A. Sem isso, um produto que sozinho vale 85%
--        cairia em B e a classe A ficaria VAZIA — resultado que faz o usuário
--        desconfiar da tela inteira.
--   (OR) a ordem é por receita desc, e a classe acompanha.
--   (RO) a classe viaja no RÓTULO (`A · Nome`), porque o contrato de série do
--        motor é {key,label,value} e mexer nele mudaria toda medida.
--   (ZE) produto com receita zero não entra: não classifica o que não vendeu.
--   (D0) janela sem venda é AUSÊNCIA.
--   (RE) recorte fechado.
--   (GR) a função é interna.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('41800000-0000-4000-8000-00000000000a', 'Org ABC', 'org-abc-a', 'America/Sao_Paulo')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active) VALUES
  ('41809191-0000-4000-8000-00000000000a', '41800000-0000-4000-8000-00000000000a',
   'Propostas ABC', 'propostas', 'system', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('4180ead1-0000-4000-8000-000000000001', '41800000-0000-4000-8000-00000000000a', 'Lead ABC')
ON CONFLICT (id) DO NOTHING;

-- Quatro produtos. As receitas foram escolhidas para pôr um produto EM CIMA da
-- fronteira dos 80%:
--   P1 800  → acumulado 80%   → A  (a fronteira: <= 0.80)
--   P2 150  → acumulado 95%   → B  (<= 0.95)
--   P3  40  → acumulado 99%   → C
--   P4  10  → acumulado 100%  → C
--   P5   0  → não entra
INSERT INTO public.products (id, organization_id, name, type, is_active) VALUES
  ('4180d0d0-0000-4000-8000-000000000001','41800000-0000-4000-8000-00000000000a','P1 carro chefe','unitario',true),
  ('4180d0d0-0000-4000-8000-000000000002','41800000-0000-4000-8000-00000000000a','P2 segundo','unitario',true),
  ('4180d0d0-0000-4000-8000-000000000003','41800000-0000-4000-8000-00000000000a','P3 cauda','unitario',true),
  ('4180d0d0-0000-4000-8000-000000000004','41800000-0000-4000-8000-00000000000a','P4 ponta','unitario',true),
  ('4180d0d0-0000-4000-8000-000000000005','41800000-0000-4000-8000-00000000000a','P5 nao vendeu','unitario',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, entered_at, closed_at) VALUES
  ('4180e177-0000-4000-8000-000000000001','41800000-0000-4000-8000-00000000000a','41809191-0000-4000-8000-00000000000a','4180ead1-0000-4000-8000-000000000001','vendido','2027-07-05 12:00-03','2027-07-10 12:00-03')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipe_proposta_items (id, pipe_proposta_id, product_id, sale_value) VALUES
  (gen_random_uuid(),'4180e177-0000-4000-8000-000000000001','4180d0d0-0000-4000-8000-000000000001',800),
  (gen_random_uuid(),'4180e177-0000-4000-8000-000000000001','4180d0d0-0000-4000-8000-000000000002',150),
  (gen_random_uuid(),'4180e177-0000-4000-8000-000000000001','4180d0d0-0000-4000-8000-000000000003',40),
  (gen_random_uuid(),'4180e177-0000-4000-8000-000000000001','4180d0d0-0000-4000-8000-000000000004',10),
  (gen_random_uuid(),'4180e177-0000-4000-8000-000000000001','4180d0d0-0000-4000-8000-000000000005',0);

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (FR) a fronteira: 80% exatos ainda é A
-- ===========================================================================
SELECT is(
  (SELECT s->>'label'
     FROM jsonb_array_elements(
       public._metric_leaf_curva_abc(
         '41800000-0000-4000-8000-00000000000a', 'produto',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = '4180d0d0-0000-4000-8000-000000000001'),
  'A · P1 carro chefe',
  '(FR/RO) o produto que fecha exatamente 80% é A — e a classe vem no rótulo');

SELECT is(
  (SELECT s->>'label'
     FROM jsonb_array_elements(
       public._metric_leaf_curva_abc(
         '41800000-0000-4000-8000-00000000000a', 'produto',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = '4180d0d0-0000-4000-8000-000000000002'),
  'B · P2 segundo', '(FR) o que fecha 95% é B');

SELECT is(
  (SELECT s->>'label'
     FROM jsonb_array_elements(
       public._metric_leaf_curva_abc(
         '41800000-0000-4000-8000-00000000000a', 'produto',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb) -> 'series') s
    WHERE s->>'key' = '4180d0d0-0000-4000-8000-000000000003'),
  'C · P3 cauda', '(FR) o que passa de 95% é C');

-- ===========================================================================
-- (OR) a ordem é por receita desc
-- ===========================================================================
SELECT is(
  (SELECT (s->>'value')::numeric
     FROM jsonb_array_elements(
       public._metric_leaf_curva_abc(
         '41800000-0000-4000-8000-00000000000a', 'produto',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb) -> 'series') WITH ORDINALITY AS t(s, ord)
    WHERE ord = 1),
  800::numeric, '(OR) o primeiro da série é o de maior receita');

-- ===========================================================================
-- (ZE) produto sem receita não entra
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int
     FROM jsonb_array_elements(
       public._metric_leaf_curva_abc(
         '41800000-0000-4000-8000-00000000000a', 'produto',
         tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
         'America/Sao_Paulo', '{}'::jsonb) -> 'series') s),
  4, '(ZE) quatro produtos na curva — o de receita zero não classifica');

-- ===========================================================================
-- (D0) janela sem venda é ausência
-- ===========================================================================
SELECT is(
  (public._metric_leaf_curva_abc(
     '41800000-0000-4000-8000-00000000000a', 'produto',
     tstzrange('2027-01-01T00:00:00-03', '2027-02-01T00:00:00-03', '[)'),
     'America/Sao_Paulo', '{}'::jsonb) ->> 'empty_reason'),
  'no_rows', '(D0) janela sem venda devolve ausência');

-- ===========================================================================
-- (RE) recorte fechado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public._metric_leaf_curva_abc(
       '41800000-0000-4000-8000-00000000000a', 'total',
       tstzrange('2027-07-01T00:00:00-03', '2027-08-01T00:00:00-03', '[)'),
       'America/Sao_Paulo', '{}'::jsonb) $$,
  '22023', NULL,
  '(RE) recorte fora de produto levanta 22023 — inclusive `total`');

-- ===========================================================================
-- (GR) interna
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon',
    'public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) anon não executa');

SELECT ok(
  has_function_privilege('service_role',
    'public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb)'::regprocedure, 'EXECUTE'),
  '(GR) service_role executa');

SELECT * FROM finish();
ROLLBACK;
