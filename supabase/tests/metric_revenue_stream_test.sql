-- supabase/tests/metric_revenue_stream_test.sql
--
-- ISSUE #1198 — fonte canônica do fluxo de receita pelo MOMENTO DO CLIENTE.
--
-- Prova o contrato de public.metric_revenue_stream(org, lead, sold_at, exclude):
--   (b) primeira compra           → novo_negocio
--   (c) segunda compra            → carteira
--   (d) venda ANTERIOR ESTORNADA  → NÃO conta como anterior
--   (e) empate exato de sold_at   → NÃO conta como anterior
--   (f) p_exclude_sale_event_id   → a linha não se vê no espelho
--   (g) isolamento por org        → venda de outra org não conta
--   (h) determinismo sobre histórico → venda POSTERIOR não muda a resposta
--                                      de uma âncora anterior
--
-- Run:
--   supabase start && supabase db reset && bash supabase/tests/run.sh
-- or:
--   psql "$DATABASE_URL" -f supabase/tests/metric_revenue_stream_test.sql
--
-- Roda inteiro dentro de transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(17);

-- ---------------------------------------------------------------------------
-- (a) Estrutura e grants
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'metric_revenue_stream',
  ARRAY['uuid','uuid','timestamptz','uuid'],
  '(a) metric_revenue_stream existe com a assinatura nomeada');

SELECT function_returns(
  'public', 'metric_revenue_stream',
  ARRAY['uuid','uuid','timestamp with time zone','uuid'], 'text',
  '(a) retorna text');

SELECT ok(
  has_function_privilege('authenticated', 'public.metric_revenue_stream(uuid,uuid,timestamptz,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.metric_revenue_stream(uuid,uuid,timestamptz,uuid)', 'EXECUTE'),
  '(a) EXECUTE concedido a authenticated + service_role');

SELECT ok(
  NOT has_function_privilege('anon', 'public.metric_revenue_stream(uuid,uuid,timestamptz,uuid)', 'EXECUTE'),
  '(a) anon NÃO executa');

-- ---------------------------------------------------------------------------
-- Fixtures — 2 orgs, 4 leads. sale_events semeado DIRETO (é teste de LEITOR):
-- triggers OFF + sold_at explícito para controlar a âncora temporal.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('11981198-aaaa-0000-0000-000000001198', 'Org A (#1198)', 'org-a-1198-mrs', 'America/Sao_Paulo'),
  ('11981198-bbbb-0000-0000-000000001198', 'Org B (#1198)', 'org-b-1198-mrs', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('11981198-1111-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198', 'Lead recompra'),
  ('11981198-2222-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198', 'Lead estorno'),
  ('11981198-3333-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198', 'Lead empate'),
  ('11981198-4444-0000-0000-000000001198', '11981198-bbbb-0000-0000-000000001198', 'Lead outra org')
ON CONFLICT (id) DO NOTHING;

-- Venda 1 do lead "recompra" — 10/jan.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type,
   sold_at, sale_value, currency, revenue_stream, source)
VALUES
  ('11981198-e001-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-1111-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-01-10 12:00:00-03', 1000, 'BRL', 'novo_negocio', 'backfill'),
  -- Venda do lead "estorno" — 10/jan, será ESTORNADA logo abaixo.
  ('11981198-e002-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-2222-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-01-10 12:00:00-03', 2000, 'BRL', 'novo_negocio', 'backfill'),
  -- Duas vendas do lead "empate", no MESMO instante.
  ('11981198-e003-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-3333-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-03-01 09:00:00-03', 3000, 'BRL', 'novo_negocio', 'backfill'),
  ('11981198-e004-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-3333-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-03-01 09:00:00-03', 3500, 'BRL', 'novo_negocio', 'backfill'),
  -- Venda de OUTRA org, mesmo instante-base.
  ('11981198-e005-0000-0000-000000001198', '11981198-bbbb-0000-0000-000000001198',
   '11981198-4444-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-01-10 12:00:00-03', 5000, 'BRL', 'novo_negocio', 'backfill')
ON CONFLICT (id) DO NOTHING;

-- Estorna a venda do lead "estorno".
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type,
   reversed_event_id, sold_at, sale_value, currency, revenue_stream, source)
VALUES
  ('11981198-e0f2-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-2222-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale_reversed',
   '11981198-e002-0000-0000-000000001198',
   '2026-02-01 12:00:00-03', 2000, 'BRL', 'novo_negocio', 'trigger')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) PRIMEIRA COMPRA → novo_negocio
--     Âncora ANTES de qualquer venda do lead.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-1111-0000-0000-000000001198',
    '2026-01-10 12:00:00-03'),
  'novo_negocio',
  '(b) primeira compra do lead → novo_negocio');

-- ---------------------------------------------------------------------------
-- (c) SEGUNDA COMPRA → carteira
--     Âncora DEPOIS da venda de 10/jan.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-1111-0000-0000-000000001198',
    '2026-05-20 15:00:00-03'),
  'carteira',
  '(c) segunda compra do mesmo lead → carteira');

-- ---------------------------------------------------------------------------
-- (d) VENDA ANTERIOR ESTORNADA não conta
--     Mesmo cenário de (c), mas a venda de 10/jan foi estornada.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-2222-0000-0000-000000001198',
    '2026-05-20 15:00:00-03'),
  'novo_negocio',
  '(d) venda anterior ESTORNADA não conta como anterior → novo_negocio');

-- Contraprova de (d): a venda estornada existe mesmo e está no período.
-- Sem isto, (d) passaria por a fixture estar vazia.
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = '11981198-2222-0000-0000-000000001198'
      AND event_type = 'sale'
      AND sold_at < '2026-05-20 15:00:00-03'),
  1,
  '(d) contraprova: a venda anterior existe — (d) não passa por fixture vazia');

-- E o estorno de fato aponta para ela.
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE event_type = 'sale_reversed'
      AND reversed_event_id = '11981198-e002-0000-0000-000000001198'),
  1,
  '(d) contraprova: o estorno aponta para a venda anterior');

-- ---------------------------------------------------------------------------
-- (e) EMPATE EXATO de sold_at não conta como anterior
--     Duas vendas no mesmo instante: nenhuma é recompra da outra.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-3333-0000-0000-000000001198',
    '2026-03-01 09:00:00-03'),
  'novo_negocio',
  '(e) empate exato de sold_at NÃO conta como anterior');

-- Um microssegundo depois já conta — o corte é estrito, não arbitrário.
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-3333-0000-0000-000000001198',
    '2026-03-01 09:00:00.000001-03'),
  'carteira',
  '(e) um microssegundo depois JÁ conta → carteira');

-- ---------------------------------------------------------------------------
-- (f) p_exclude_sale_event_id — a linha não se vê no espelho.
--     Caso de recálculo da #1203 sobre uma linha já gravada.
-- ---------------------------------------------------------------------------
-- A exclusão é PRECISA: tira a linha nomeada, não a classe. O lead "empate"
-- tem DUAS vendas no mesmo instante, então excluir uma ainda deixa a outra
-- como anterior. (Esta asserção nasceu esperando 'novo_negocio' e o teste
-- reprovou — a função estava certa e a expectativa errada.)
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-3333-0000-0000-000000001198',
    '2026-03-01 09:00:00.000001-03',
    '11981198-e003-0000-0000-000000001198'),
  'carteira',
  '(f) excluir UMA de duas vendas anteriores ainda deixa a outra → carteira');

SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-1111-0000-0000-000000001198',
    '2026-05-20 15:00:00-03',
    '11981198-e001-0000-0000-000000001198'),
  'novo_negocio',
  '(f) excluindo a venda de jan, a recompra vira primeira compra');

-- ---------------------------------------------------------------------------
-- (g) ISOLAMENTO POR ORG — venda de outra org não conta.
--     Cross-tenant numa função de dinheiro é o erro caro; provado explícito.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-bbbb-0000-0000-000000001198',
    '11981198-4444-0000-0000-000000001198',
    '2026-05-20 15:00:00-03'),
  'carteira',
  '(g) org B enxerga a própria venda anterior → carteira');

SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-4444-0000-0000-000000001198',
    '2026-05-20 15:00:00-03'),
  'novo_negocio',
  '(g) org A NÃO enxerga a venda do lead da org B → novo_negocio');

-- ---------------------------------------------------------------------------
-- (h) DETERMINISMO SOBRE HISTÓRICO — o ponto da fatia.
--     Uma venda POSTERIOR não pode mudar a etiqueta de uma âncora anterior.
--     A expressão antiga (upsell_clients.is_active) falhava exatamente aqui:
--     dependia do estado de AGORA, então a resposta mudava com o mundo.
-- ---------------------------------------------------------------------------
SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-1111-0000-0000-000000001198',
    '2026-01-10 12:00:00-03'),
  'novo_negocio',
  '(h) a venda de MAIO não retroage sobre a âncora de JANEIRO');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type,
   sold_at, sale_value, currency, revenue_stream, source)
VALUES
  ('11981198-e006-0000-0000-000000001198', '11981198-aaaa-0000-0000-000000001198',
   '11981198-1111-0000-0000-000000001198', gen_random_uuid(), 'vendido', 'sale',
   '2026-09-01 12:00:00-03', 9000, 'BRL', 'novo_negocio', 'trigger')
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = origin;

SELECT is(
  public.metric_revenue_stream(
    '11981198-aaaa-0000-0000-000000001198',
    '11981198-1111-0000-0000-000000001198',
    '2026-01-10 12:00:00-03'),
  'novo_negocio',
  '(h) inserir venda em SETEMBRO não muda a resposta de JANEIRO — determinística');

SELECT * FROM finish();

ROLLBACK;
