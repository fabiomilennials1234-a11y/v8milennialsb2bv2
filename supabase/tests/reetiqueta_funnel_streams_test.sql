-- supabase/tests/reetiqueta_funnel_streams_test.sql
--
-- ISSUE — Opção B: reescrita das vendas de funil mal-etiquetadas (PRD #1194).
-- Corrigido na volta 1 (reprova do Crivo): o guard de ordem e o caso cego.
--
-- Prova:
--   (a) funções existem, só service_role executa
--   (b) GUARD: recusa rodar contra livro SEM venda de Carteira (#1202 não rodou)
--   (c) o caso CEGO da volta 1: venda de funil marcada 'carteira' com uma venda
--       de PRODUTOR CARTEIRA anterior é RECOMPRA legítima → NÃO reescrita
--   (d) a reescrita move só a primeira-compra-de-verdade (sem Carteira anterior)
--   (e) receita viva total inalterada; divisão muda no valor exato
--   (f) idempotente; não projeta comissão; rollback restaura
--
-- Roda inteiro dentro de transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'fn_reetiqueta_funnel_streams', ARRAY['uuid','boolean'],
  '(a) fn_reetiqueta_funnel_streams existe');
SELECT has_function('public', 'fn_rollback_reetiqueta_funnel', ARRAY['uuid'],
  '(a) fn_rollback_reetiqueta_funnel existe');
SELECT ok(
  has_function_privilege('service_role', 'public.fn_reetiqueta_funnel_streams(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fn_reetiqueta_funnel_streams(uuid,boolean)', 'EXECUTE'),
  '(a) só service_role executa a reescrita');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('c1203b00-aaaa-0000-0000-000000001203', 'Org (#1203b)', 'org-1203b-rf', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('c1203b00-1111-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203', 'L primeira real'),
  ('c1203b00-2222-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203', 'L caso-cego (Carteira antes)'),
  ('c1203b00-3333-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203', 'L recompra funil'),
  ('c1203b00-4444-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203', 'L ja correta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.upsell_clients (id, organization_id, lead_id, name, is_active) VALUES
  ('c1203b00-c222-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-2222-0000-0000-000000001203', 'Cliente caso-cego', true)
ON CONFLICT (id) DO NOTHING;

-- Lead 1111: venda de funil marcada 'carteira', SEM nenhuma venda anterior.
--   → primeira compra de verdade → ALVO da reescrita.
-- Lead 2222: o CASO CEGO da volta 1. Uma venda de PRODUTOR CARTEIRA em janeiro
--   (a recompra que o #1202 já inseriu) + uma venda de FUNIL em março marcada
--   'carteira'. Contra o livro COMPLETO, a de março É recompra → 'carteira' está
--   CERTA → NÃO deve ser reescrita. Este é o caso que o teste antigo não cobria
--   e que vale 90% do dinheiro em prod (46 de 51 linhas).
-- Lead 3333: recompra via FUNIL (janeiro novo + maio carteira). A de maio é
--   correta; intocada.
-- Lead 4444: primeira compra já etiquetada novo_negocio; intocada.
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, currency, revenue_stream, source, producer, origin_record_id)
VALUES
  -- alvo real
  ('c1203b00-e001-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-1111-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-03-01 10:00:00-03', 1000, 'BRL', 'carteira', 'trigger', 'funnel', NULL),
  -- caso cego: venda de PRODUTOR CARTEIRA anterior (a recompra do #1202)
  ('c1203b00-ec22-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-2222-0000-0000-000000001203', NULL, NULL, 'sale',
   '2026-01-15 10:00:00-03', 8000, 'BRL', 'novo_negocio', 'trigger', 'carteira',
   'c1203b00-0d22-0000-0000-000000001203'),
  -- caso cego: venda de FUNIL marcada carteira, POSTERIOR à de Carteira
  ('c1203b00-e002-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-2222-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-03-02 10:00:00-03', 2000, 'BRL', 'carteira', 'trigger', 'funnel', NULL),
  -- recompra via funil
  ('c1203b00-e003-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-3333-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-01-10 10:00:00-03', 3000, 'BRL', 'novo_negocio', 'backfill', 'funnel', NULL),
  ('c1203b00-e004-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-3333-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-05-10 10:00:00-03', 3500, 'BRL', 'carteira', 'trigger', 'funnel', NULL),
  -- já correta
  ('c1203b00-e005-0000-0000-000000001203', 'c1203b00-aaaa-0000-0000-000000001203',
   'c1203b00-4444-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-02-01 10:00:00-03', 500, 'BRL', 'novo_negocio', 'backfill', 'funnel', NULL)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE _antes AS
SELECT
  round(coalesce(sum(sale_value) FILTER (WHERE event_type='sale'
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=s.id)),0),2) AS receita,
  round(coalesce(sum(sale_value) FILTER (WHERE event_type='sale' AND revenue_stream='carteira'
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=s.id)),0),2) AS carteira
FROM public.sale_events s WHERE organization_id='c1203b00-aaaa-0000-0000-000000001203';

-- ---------------------------------------------------------------------------
-- (b) GUARD — sem Carteira no livro, recusa rodar
-- ---------------------------------------------------------------------------
-- Org SEPARADA, com uma venda de funil mal-etiquetada mas SEM nenhuma venda de
-- Carteira — o estado exato do livro antes do #1202 rodar. O guard tem que
-- barrar. (Não mutilamos a org principal: trocar producer da venda de Carteira
-- violaria o CHECK de coerência funnel↔funil.)
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('c1203b00-bbbb-0000-0000-000000001203', 'Org sem Carteira', 'org-1203b-noc', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.leads (id, organization_id, name) VALUES
  ('c1203b00-b111-0000-0000-000000001203', 'c1203b00-bbbb-0000-0000-000000001203', 'L sem carteira')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, currency, revenue_stream, source, producer)
VALUES
  ('c1203b00-eb11-0000-0000-000000001203', 'c1203b00-bbbb-0000-0000-000000001203',
   'c1203b00-b111-0000-0000-000000001203', gen_random_uuid(), 'ganho', 'sale',
   '2026-03-01 10:00:00-03', 1000, 'BRL', 'carteira', 'trigger', 'funnel')
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  $$ SELECT public.fn_reetiqueta_funnel_streams('c1203b00-bbbb-0000-0000-000000001203', false) $$,
  'P0001', NULL,
  '(b) GUARD: recusa executar quando o livro não tem venda de Carteira (#1202 não rodou)');

-- ---------------------------------------------------------------------------
-- (c)+(d) Execução real, agora com Carteira no livro
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT reescritas FROM public.fn_reetiqueta_funnel_streams('c1203b00-aaaa-0000-0000-000000001203', false)),
  1,
  '(d) reescreve SÓ a primeira-compra-de-verdade (lead 1111) — 1, não 2');

-- O CASO CEGO: a venda de funil do lead 2222 NÃO foi reescrita, porque tem uma
-- venda de Carteira anterior → é recompra → carteira está certa.
SELECT is(
  (SELECT revenue_stream FROM public.sale_events WHERE id='c1203b00-e002-0000-0000-000000001203'),
  'carteira',
  '(c) CASO CEGO: funil-carteira com venda de Carteira anterior segue carteira — NÃO reescrita');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.sale_events WHERE reversed_event_id='c1203b00-e002-0000-0000-000000001203'),
  '(c) CASO CEGO: a linha não foi estornada');

-- A primeira-compra-real virou novo_negocio.
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE origin_record_id='c1203b00-e001-0000-0000-000000001203'
      AND event_type='sale' AND revenue_stream='novo_negocio'),
  1,
  '(d) a reemissão do lead 1111 saiu novo_negocio');

-- ---------------------------------------------------------------------------
-- (e) Total inalterado, divisão muda no valor exato (só R$ 1000: o lead 1111)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT round(coalesce(sum(sale_value) FILTER (WHERE event_type='sale'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=s.id)),0),2)
   FROM public.sale_events s WHERE organization_id='c1203b00-aaaa-0000-0000-000000001203'),
  (SELECT receita FROM _antes),
  '(e) receita viva TOTAL inalterada');

SELECT is(
  (SELECT round(coalesce(sum(sale_value) FILTER (WHERE event_type='sale' AND revenue_stream='carteira'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=s.id)),0),2)
   FROM public.sale_events s WHERE organization_id='c1203b00-aaaa-0000-0000-000000001203'),
  (SELECT carteira FROM _antes) - 1000,
  '(e) carteira caiu SÓ R$ 1000 (o lead 1111) — não R$ 3000');

-- ---------------------------------------------------------------------------
-- (g) recompra via funil e linha já correta intocadas
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT revenue_stream FROM public.sale_events WHERE id='c1203b00-e004-0000-0000-000000001203'),
  'carteira',
  '(g) recompra via funil segue carteira — intocada');

-- ---------------------------------------------------------------------------
-- (f) idempotência, comissão, rollback
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT reescritas FROM public.fn_reetiqueta_funnel_streams('c1203b00-aaaa-0000-0000-000000001203', false)),
  0,
  '(f) segunda execução não reescreve nada');

SELECT is(
  (SELECT count(*)::int FROM public.commissions c
    JOIN public.sale_events se ON se.id=c.sale_event_id
   WHERE se.producer='funnel' AND se.source='backfill'
     AND se.organization_id='c1203b00-aaaa-0000-0000-000000001203'),
  0,
  '(f) nenhuma comissão projetada pelas linhas reescritas');

SELECT is(
  public.fn_rollback_reetiqueta_funnel('c1203b00-aaaa-0000-0000-000000001203'),
  2,
  '(f) rollback remove as 2 linhas criadas (1 estorno + 1 reemissão)');

SELECT is(
  (SELECT round(coalesce(sum(sale_value) FILTER (WHERE event_type='sale' AND revenue_stream='carteira'
     AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type='sale_reversed' AND r.reversed_event_id=s.id)),0),2)
   FROM public.sale_events s WHERE organization_id='c1203b00-aaaa-0000-0000-000000001203'),
  (SELECT carteira FROM _antes),
  '(f) pós-rollback: carteira volta ao valor original');

SELECT * FROM finish();

ROLLBACK;
