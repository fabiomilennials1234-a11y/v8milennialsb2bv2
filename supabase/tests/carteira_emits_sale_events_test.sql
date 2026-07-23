-- supabase/tests/carteira_emits_sale_events_test.sql
--
-- ISSUE #1201 — Carteira emite para o livro-razão, atrás de flag.
--
-- Prova:
--   (a) flag existe e nasce DESLIGADA; gatilhos no lugar
--   (b) FLAG OFF: aprovar pedido NÃO emite nada  ← critério mais importante
--   (c) FLAG ON: emite com a data do PEDIDO (não a da aprovação), sem funil,
--       com identidade de produtor e origem
--   (d) aprovar 2x emite 1x (chave de idempotência da #1199)
--   (e) 1ª compra = novo_negocio; recompra = carteira (regra da #1198)
--   (f) rejeitar pedido aprovado estorna; rejeitar 2x estorna 1x
--   (g) comissão BLOQUEADA para produtor de carteira — por teste, não por leitura
--   (h) isolamento entre orgs
--   (i) atribuição só por sale_responsible_id; sem responsável = não-atribuído
--
-- Roda inteiro dentro de transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'organizations', 'carteira_emits_revenue_enabled',
  '(a) flag de rollout existe');

SELECT col_default_is('public', 'organizations', 'carteira_emits_revenue_enabled', 'false',
  '(a) flag NASCE DESLIGADA — rollout é opt-in por org');

SELECT has_trigger('public', 'upsell_orders', 'trg_carteira_emit_sale_event_upd',
  '(a) gatilho de emissão na aprovação');
SELECT has_trigger('public', 'upsell_orders', 'trg_carteira_reverse_sale_event',
  '(a) gatilho de estorno na rejeição');
SELECT has_trigger('public', 'commissions', 'trg_block_commission_for_carteira',
  '(a) guard de comissão declarado');

-- ---------------------------------------------------------------------------
-- Fixtures — 2 orgs. Org A entra no piloto; Org B fica de fora.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('12011201-aaaa-0000-0000-000000001201', 'Org A (#1201)', 'org-a-1201-ces', 'America/Sao_Paulo'),
  ('12011201-bbbb-0000-0000-000000001201', 'Org B (#1201)', 'org-b-1201-ces', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('12011201-1111-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201', 'Lead A'),
  ('12011201-2222-0000-0000-000000001201', '12011201-bbbb-0000-0000-000000001201', 'Lead B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.upsell_clients (id, organization_id, lead_id, name) VALUES
  ('12011201-c111-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   '12011201-1111-0000-0000-000000001201', 'Cliente A'),
  ('12011201-c222-0000-0000-000000001201', '12011201-bbbb-0000-0000-000000001201',
   '12011201-2222-0000-0000-000000001201', 'Cliente B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, name, role, is_active) VALUES
  ('12011201-8888-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   'Vendedor #1201', 'member', true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (b) FLAG OFF — o critério mais importante da fatia
-- ---------------------------------------------------------------------------
INSERT INTO public.upsell_orders
  (id, organization_id, client_id, product_name, product_type, sale_value,
   origin, sold_at, approval_status)
VALUES
  ('12011201-0d01-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   '12011201-c111-0000-0000-000000001201', 'Produto X', 'mrr', 5000,
   'upsell', '2026-02-10 09:00:00-03', 'pending');

UPDATE public.upsell_orders SET approval_status = 'approved'
WHERE id = '12011201-0d01-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE producer = 'carteira' AND origin_record_id = '12011201-0d01-0000-0000-000000001201'),
  0,
  '(b) FLAG OFF: aprovar pedido NÃO emite nada no livro');

-- ---------------------------------------------------------------------------
-- (c) FLAG ON — liga só a Org A
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
UPDATE public.organizations SET carteira_emits_revenue_enabled = true
WHERE id = '12011201-aaaa-0000-0000-000000001201';

INSERT INTO public.upsell_orders
  (id, organization_id, client_id, product_name, product_type, sale_value,
   origin, sold_at, approval_status, sale_responsible_id)
VALUES
  ('12011201-0d02-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   '12011201-c111-0000-0000-000000001201', 'Produto Y', 'mrr', 7000,
   'upsell', '2026-03-15 14:00:00-03', 'pending', NULL);

UPDATE public.upsell_orders SET approval_status = 'approved', approved_at = now()
WHERE id = '12011201-0d02-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE producer='carteira' AND origin_record_id='12011201-0d02-0000-0000-000000001201'
      AND event_type='sale'),
  1,
  '(c) FLAG ON: aprovar emite UMA venda');

-- A data é a do PEDIDO, não a da aprovação. Este é o ponto que a isenção da
-- #1199 sustenta: sem ela o gatilho de normalização sobrescreveria com now().
SELECT is(
  (SELECT sold_at FROM public.sale_events
    WHERE origin_record_id='12011201-0d02-0000-0000-000000001201' AND event_type='sale'),
  '2026-03-15 14:00:00-03'::timestamptz,
  '(c) data da venda = a do PEDIDO, não a da aprovação');

SELECT ok(
  (SELECT pipeline_id IS NULL AND stage_key IS NULL AND source = 'trigger'
     FROM public.sale_events
    WHERE origin_record_id='12011201-0d02-0000-0000-000000001201' AND event_type='sale'),
  '(c) sem funil e sem etapa, e a fonte segue "trigger"');

-- ---------------------------------------------------------------------------
-- (d) Aprovar 2x emite 1x
-- ---------------------------------------------------------------------------
UPDATE public.upsell_orders SET approval_status = 'pending'
WHERE id = '12011201-0d02-0000-0000-000000001201';
UPDATE public.upsell_orders SET approval_status = 'approved'
WHERE id = '12011201-0d02-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE origin_record_id='12011201-0d02-0000-0000-000000001201' AND event_type='sale'),
  1,
  '(d) aprovar DE NOVO não duplica — a chave da #1199 pega');

-- ---------------------------------------------------------------------------
-- (e) Etiqueta pelo momento do cliente (#1198)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE origin_record_id='12011201-0d02-0000-0000-000000001201' AND event_type='sale'),
  'novo_negocio',
  '(e) PRIMEIRA compra do cliente sai como novo_negocio');

-- Segundo pedido do MESMO cliente, posterior: é recompra.
INSERT INTO public.upsell_orders
  (id, organization_id, client_id, product_name, product_type, sale_value,
   origin, sold_at, approval_status)
VALUES
  ('12011201-0d03-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   '12011201-c111-0000-0000-000000001201', 'Produto Z', 'mrr', 3000,
   'upsell', '2026-06-20 10:00:00-03', 'pending');

UPDATE public.upsell_orders SET approval_status = 'approved'
WHERE id = '12011201-0d03-0000-0000-000000001201';

SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE origin_record_id='12011201-0d03-0000-0000-000000001201' AND event_type='sale'),
  'carteira',
  '(e) RECOMPRA sai como carteira — "carteira" deixa de ser zero');

-- ---------------------------------------------------------------------------
-- (f) Estorno
-- ---------------------------------------------------------------------------
UPDATE public.upsell_orders SET approval_status = 'rejected'
WHERE id = '12011201-0d03-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE origin_record_id='12011201-0d03-0000-0000-000000001201'
      AND event_type='sale_reversed'),
  1,
  '(f) rejeitar pedido aprovado emite estorno');

-- E o estorno aponta para a venda DAQUELE pedido, não para outra qualquer.
SELECT is(
  (SELECT r.reversed_event_id FROM public.sale_events r
    WHERE r.origin_record_id='12011201-0d03-0000-0000-000000001201'
      AND r.event_type='sale_reversed'),
  (SELECT s.id FROM public.sale_events s
    WHERE s.origin_record_id='12011201-0d03-0000-0000-000000001201'
      AND s.event_type='sale'),
  '(f) o estorno referencia a venda DAQUELE pedido');

UPDATE public.upsell_orders SET approval_status = 'approved'
WHERE id = '12011201-0d03-0000-0000-000000001201';
UPDATE public.upsell_orders SET approval_status = 'rejected'
WHERE id = '12011201-0d03-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE origin_record_id='12011201-0d03-0000-0000-000000001201'
      AND event_type='sale_reversed'),
  1,
  '(f) rejeitar DE NOVO não duplica o estorno');

-- ---------------------------------------------------------------------------
-- (g) COMISSÃO BLOQUEADA — por teste, não por leitura
-- ---------------------------------------------------------------------------
SELECT throws_ok($$
  INSERT INTO public.commissions
    (organization_id, team_member_id, amount, month, year, sale_event_id, source, type)
  SELECT '12011201-aaaa-0000-0000-000000001201', '12011201-8888-0000-0000-000000001201', 100, 3, 2026, se.id,
         'sale_event_projection', 'mrr'
  FROM public.sale_events se
  WHERE se.origin_record_id = '12011201-0d02-0000-0000-000000001201'
    AND se.event_type = 'sale'
$$, 'P0001', NULL,
  '(g) projetar comissão sobre linha de CARTEIRA é BLOQUEADO');

-- Contraprova: o guard não bloqueia comissão de linha de FUNIL. Sem isto ele
-- poderia estar barrando tudo e o teste (g) passaria por acidente.
SET LOCAL session_replication_role = replica;
INSERT INTO public.sale_events
  (id, organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at,
   sale_value, currency, revenue_stream, source, producer)
VALUES
  ('12011201-e999-0000-0000-000000001201', '12011201-aaaa-0000-0000-000000001201',
   '12011201-1111-0000-0000-000000001201', gen_random_uuid(), 'vendido', 'sale',
   '2026-03-20 10:00:00-03', 1000, 'BRL', 'novo_negocio', 'trigger', 'funnel');
SET LOCAL session_replication_role = origin;

SELECT lives_ok($$
  INSERT INTO public.commissions
    (organization_id, team_member_id, amount, month, year, sale_event_id, source, type)
  VALUES ('12011201-aaaa-0000-0000-000000001201', '12011201-8888-0000-0000-000000001201', 100, 3, 2026,
          '12011201-e999-0000-0000-000000001201', 'sale_event_projection', 'mrr')
$$, '(g) contraprova: comissão de linha de FUNIL não é bloqueada');

-- ---------------------------------------------------------------------------
-- (h) Isolamento entre orgs — Org B está FORA do piloto
-- ---------------------------------------------------------------------------
INSERT INTO public.upsell_orders
  (id, organization_id, client_id, product_name, product_type, sale_value,
   origin, sold_at, approval_status)
VALUES
  ('12011201-0d04-0000-0000-000000001201', '12011201-bbbb-0000-0000-000000001201',
   '12011201-c222-0000-0000-000000001201', 'Produto B', 'mrr', 9000,
   'upsell', '2026-03-15 14:00:00-03', 'pending');

UPDATE public.upsell_orders SET approval_status = 'approved'
WHERE id = '12011201-0d04-0000-0000-000000001201';

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE origin_record_id = '12011201-0d04-0000-0000-000000001201'),
  0,
  '(h) org FORA do piloto não emite, mesmo com a org vizinha ligada');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE producer='carteira' AND organization_id='12011201-bbbb-0000-0000-000000001201'),
  0,
  '(h) nenhuma linha de Carteira caiu na org B');

-- ---------------------------------------------------------------------------
-- (i) Atribuição — só a chave canônica
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT sale_responsible_id FROM public.sale_events
    WHERE origin_record_id='12011201-0d02-0000-0000-000000001201' AND event_type='sale'),
  NULL::uuid,
  '(i) pedido sem responsável de venda cai em NÃO-ATRIBUÍDO, igual ao funil');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE producer='carteira' AND organization_id='12011201-aaaa-0000-0000-000000001201'
      AND event_type='sale'),
  2,
  '(i) org A do piloto tem exatamente as 2 vendas de Carteira esperadas');

SELECT * FROM finish();

ROLLBACK;
