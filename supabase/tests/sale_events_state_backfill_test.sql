-- supabase/tests/sale_events_state_backfill_test.sql
--
-- ISSUE U2 (PRD #986, ADR-0017 §7 governed CURRENT-STATE backfill) — pgTAP do
-- backfill de venda por ESTADO. Mata o gap: vendas já paradas em stage won/lost
-- (do estado vivo do kanban) precisam CONTAR quando as métricas canônicas
-- ligam. Espelha o alinhamento terminal do #992 (Parte B) para a RECEITA.
--
-- Honestidade (ADR-0017 §4 vs §7): NÃO fabrica sold_at=now() — usa o momento
-- REAL da entrada no stage terminal (pipeline_entries.stage_changed_at). O
-- normalizador force_sold_at só mexe em source='trigger'; backfill preserva.
--
-- Run:
--   pg_prove -d "$DATABASE_URL" supabase/tests/sale_events_state_backfill_test.sql
--
-- Asserts (1 comportamento por fatia, TDD):
--   1. won vivo → 1 sale (event_type/sold_at real/valor/atribuição/stream)
--   2. lost vivo → 1 sale_lost
--   3. stage open/meeting → nenhum evento
--   4. idempotência: rodar 2x → 1 linha
--   5. source='backfill' preservado; sold_at NÃO normalizado pra now()
--   6. Carteira Client ativo → revenue_stream='carteira'; senão novo_negocio
--   7. sale_value malformado/ausente → NULL (linha criada, honesta)
--   8. won com sale AO VIVO no ledger → backfill NÃO duplica

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures base: 1 org, closer/sdr, funil propostas de sistema governado.
-- Seeds com triggers OFF (padrão do repo) — entries "pré-caderno" NÃO geram
-- captura ao vivo; é exatamente o estado que o backfill precisa cobrir.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES ('e2000000-aaaa-0000-0000-000000000001', 'Org U2', 'org-u2-backfill');

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('e2000000-aaaa-2222-0000-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   NULL, 'Closer U2', 'admin', true),
  ('e2000000-aaaa-2222-0001-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   NULL, 'SDR U2', 'membro', true);

-- L1: novo negócio, atribuição canônica completa. L2: parado em stage open.
INSERT INTO public.leads (id, organization_id, name,
                          sale_responsible_id, pre_sale_responsible_id, closer_id)
VALUES
  ('e2000000-aaaa-3333-0001-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L1', 'e2000000-aaaa-2222-0000-000000000001',
   'e2000000-aaaa-2222-0001-000000000001', NULL),
  ('e2000000-aaaa-3333-0002-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L2 open', 'e2000000-aaaa-2222-0000-000000000001', NULL, NULL),
  ('e2000000-aaaa-3333-0003-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L3 lost', 'e2000000-aaaa-2222-0000-000000000001', NULL, NULL),
  ('e2000000-aaaa-3333-0004-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L4 carteira', 'e2000000-aaaa-2222-0000-000000000001', NULL, NULL),
  ('e2000000-aaaa-3333-0005-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L5 valor malformado', 'e2000000-aaaa-2222-0000-000000000001', NULL, NULL),
  ('e2000000-aaaa-3333-0006-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
   'Lead L6 venda ao vivo', 'e2000000-aaaa-2222-0000-000000000001', NULL, NULL);

-- L4 é Carteira Client ATIVO vendendo pelo funil normal (ADR-0017 §2).
INSERT INTO public.upsell_clients (id, organization_id, lead_id, name, is_active)
VALUES ('e2000000-aaaa-7777-0000-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-3333-0004-000000000001', 'Cliente Carteira L4', true);

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'Propostas U2', 'propostas', 'system');

INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES
  ('e2000000-aaaa-0000-0000-000000000001', 'propostas', 'enviada', 'Enviada', 1, 'open'),
  ('e2000000-aaaa-0000-0000-000000000001', 'propostas', 'vendido', 'Vendido', 2, 'won'),
  ('e2000000-aaaa-0000-0000-000000000001', 'propostas', 'perdido', 'Perdido', 3, 'lost');

-- L1 parado em 'vendido' desde 2026-06-15 (momento REAL da entrada no terminal).
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0001-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0001-000000000001',
        'vendido', '{"sale_value": 1500.50}'::jsonb,
        '2026-06-15T13:00:00Z', '2026-06-10T09:00:00Z', '2026-06-10T09:00:00Z');

-- L2 parado num stage OPEN ('enviada') — não é venda nem perda.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0002-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0002-000000000001',
        'enviada', '{}'::jsonb,
        '2026-06-16T10:00:00Z', '2026-06-16T10:00:00Z', '2026-06-16T10:00:00Z');

-- L3 parado em 'perdido' (lost) desde 2026-06-14.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0003-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0003-000000000001',
        'perdido', '{}'::jsonb,
        '2026-06-14T11:00:00Z', '2026-06-12T08:00:00Z', '2026-06-12T08:00:00Z');

-- L4 parado em 'vendido' (won), mas é Carteira Client ativo → stream carteira.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0004-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0004-000000000001',
        'vendido', '{"sale_value": 900}'::jsonb,
        '2026-06-17T15:00:00Z', '2026-06-13T08:00:00Z', '2026-06-13T08:00:00Z');

-- L5 parado em 'vendido' com sale_value MALFORMADO (metadata é jsonb livre).
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0005-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0005-000000000001',
        'vendido', '{"sale_value": "R$ mil"}'::jsonb,
        '2026-06-18T09:00:00Z', '2026-06-13T08:00:00Z', '2026-06-13T08:00:00Z');

SET LOCAL session_replication_role = origin;

-- L6: venda capturada AO VIVO (triggers ON) ANTES do backfill — entra em
-- 'enviada' (open) e transiciona pra 'vendido' (won). A cadeia
-- pipeline_entries → pipeline_stage_events → sale_events grava 1 sale
-- source='trigger'. O backfill NÃO pode adicionar uma segunda.
INSERT INTO public.pipeline_entries
  (id, organization_id, pipeline_id, lead_id, stage_key, metadata,
   stage_changed_at, entered_at, created_at)
VALUES ('e2000000-aaaa-5555-0006-000000000001', 'e2000000-aaaa-0000-0000-000000000001',
        'e2000000-aaaa-4444-0000-000000000001', 'e2000000-aaaa-3333-0006-000000000001',
        'enviada', '{"sale_value": 300}'::jsonb, now(), now(), now());
UPDATE public.pipeline_entries
SET stage_key = 'vendido'
WHERE id = 'e2000000-aaaa-5555-0006-000000000001';

-- ---------------------------------------------------------------------------
-- (1) Tracer: won vivo → exatamente 1 sale, honesto em todos os campos.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.fn_backfill_state_sales() $$,
  '(1) backfill roda');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  1, '(1) won vivo gera exatamente 1 sale_event');

SELECT is(
  (SELECT event_type FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  'sale', '(1) event_type = sale');

SELECT is(
  (SELECT sold_at FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  '2026-06-15T13:00:00Z'::timestamptz,
  '(1) sold_at = stage_changed_at REAL (NÃO now())');

SELECT is(
  (SELECT sale_value FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  1500.50::numeric, '(1) sale_value snapshot da metadata');

SELECT is(
  (SELECT sale_responsible_id::text FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  'e2000000-aaaa-2222-0000-000000000001',
  '(1) sale_responsible_id = closer canônico do lead');

SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  'novo_negocio', '(1) lead sem Carteira → novo_negocio');

-- ---------------------------------------------------------------------------
-- (3) Stage open/meeting NÃO gera evento — resolução por metric_stage_role.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0002-000000000001'),
  0, '(3) entry em stage open não gera evento de venda');

-- ---------------------------------------------------------------------------
-- (2) lost vivo → exatamente 1 sale_lost.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0003-000000000001'),
  1, '(2) lost vivo gera exatamente 1 sale_event');

SELECT is(
  (SELECT event_type FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0003-000000000001'),
  'sale_lost', '(2) event_type = sale_lost');

-- ---------------------------------------------------------------------------
-- (6) Revenue Stream decidido pelo CLIENTE (Carteira Client ativo → carteira).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT revenue_stream FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0004-000000000001'),
  'carteira', '(6) Carteira Client ativo → revenue_stream carteira');

-- ---------------------------------------------------------------------------
-- (7) sale_value malformado → NULL (linha criada, honesta), nunca 0/erro.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0005-000000000001'),
  1, '(7) valor malformado ainda cria a venda (não bloqueia)');

SELECT is(
  (SELECT sale_value FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0005-000000000001'),
  NULL, '(7) sale_value malformado → NULL (nunca 0 fabricado)');

-- ---------------------------------------------------------------------------
-- (5) source='backfill' preservado — prova que o normalizador force_sold_at
--     (WHEN source='trigger') NÃO tocou sold_at (segue = stage_changed_at).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT source FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  'backfill', '(5) linha de backfill carrega source=backfill');

-- ---------------------------------------------------------------------------
-- (8) won com sale AO VIVO (source=trigger) no ledger → backfill NÃO duplica.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0006-000000000001'),
  1, '(8) venda ao vivo não ganha segunda linha pelo backfill');

SELECT is(
  (SELECT source FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0006-000000000001'),
  'trigger', '(8) a única linha é a captura ao vivo (trigger), não backfill');

-- ---------------------------------------------------------------------------
-- (4) Idempotência: rodar o backfill de novo NÃO duplica nenhuma linha.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.fn_backfill_state_sales() $$,
  '(4) segundo backfill roda');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE lead_id = 'e2000000-aaaa-3333-0001-000000000001'),
  1, '(4) won L1 continua com exatamente 1 linha após 2ª rodada');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE organization_id = 'e2000000-aaaa-0000-0000-000000000001'),
  5, '(4) total da org inalterado (4 backfill + 1 ao vivo) após 2ª rodada');

SELECT * FROM finish();

ROLLBACK;
