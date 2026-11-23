-- supabase/tests/trava_de_valor_religar_org_test.sql
--
-- Migration 20280123002000 — religa a trava de valor na venda para uma org.
--
-- A trava mora em `fn_exige_valor_no_negocio` (UPDATE de deals.outcome) e lê
-- `rollout_exige_valor_venda`: org com `religado_em IS NULL` passa sem valor.
-- A migration só marca `religado_em` da Bolivar, que não existe num banco de
-- teste; por isso a suíte exercita o MESMO UPDATE sobre uma org de fixture.
--
-- O que a suíte prova:
--   (ANTES)   org poupada ganha negócio sem valor.
--   (DEPOIS)  religada: ganhar sem valor é recusado, com a frase da trava.
--   (RECUPERA) religada: valor só na entrada do funil é recuperado, não recusado.
--   (ZERO)    religada: valor 0 é resposta válida.
--   (FORA)    outra org poupada continua passando — religar é por org.
--
-- Os demais gatilhos de deals.outcome são desligados na transação: o que se
-- testa aqui é a trava, não a movimentação de etapa nem o caderno de vendas.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('b0114a00-0000-4000-8000-0000000000a1', 'Org Religar',  'org-religar',  'America/Sao_Paulo'),
  ('b0114a00-0000-4000-8000-0000000000a2', 'Org Poupada',  'org-poupada-r', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rollout_exige_valor_venda (organization_id, motivo, vendas_6m, pct_sem_valor) VALUES
  ('b0114a00-0000-4000-8000-0000000000a1', 'fixture', 1, 100),
  ('b0114a00-0000-4000-8000-0000000000a2', 'fixture', 1, 100)
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('b0114a00-0000-4000-8000-0000000000b1', 'b0114a00-0000-4000-8000-0000000000a1', 'Lead Religar'),
  ('b0114a00-0000-4000-8000-0000000000b2', 'b0114a00-0000-4000-8000-0000000000a2', 'Lead Poupada');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('b0114a00-0000-4000-8000-0000000000c1', 'b0114a00-0000-4000-8000-0000000000a1', 'Funil Religar', 'funil-religar', 'custom');

INSERT INTO public.deals (id, organization_id, source_lead_id, title, source, value) VALUES
  ('b0114a00-0000-4000-8000-0000000000d1', 'b0114a00-0000-4000-8000-0000000000a1', 'b0114a00-0000-4000-8000-0000000000b1', 'Antes',    'human', NULL),
  ('b0114a00-0000-4000-8000-0000000000d2', 'b0114a00-0000-4000-8000-0000000000a1', 'b0114a00-0000-4000-8000-0000000000b1', 'Depois',   'human', NULL),
  ('b0114a00-0000-4000-8000-0000000000d3', 'b0114a00-0000-4000-8000-0000000000a1', 'b0114a00-0000-4000-8000-0000000000b1', 'Recupera', 'human', NULL),
  ('b0114a00-0000-4000-8000-0000000000d4', 'b0114a00-0000-4000-8000-0000000000a1', 'b0114a00-0000-4000-8000-0000000000b1', 'Zero',     'human', 0),
  ('b0114a00-0000-4000-8000-0000000000d5', 'b0114a00-0000-4000-8000-0000000000a2', 'b0114a00-0000-4000-8000-0000000000b2', 'Fora',     'human', NULL);

-- O valor do negócio "Recupera" só existe na entrada do funil.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, deal_id, metadata) VALUES
  ('b0114a00-0000-4000-8000-0000000000e3', 'b0114a00-0000-4000-8000-0000000000a1', 'b0114a00-0000-4000-8000-0000000000c1',
   'b0114a00-0000-4000-8000-0000000000b1', 'proposta', 'b0114a00-0000-4000-8000-0000000000d3', '{"sale_value": "250.50"}'::jsonb);

SET LOCAL session_replication_role = origin;

-- A trava é a única coisa sob teste.
ALTER TABLE public.deals DISABLE TRIGGER trg_deal_outcome_para_caderno;
ALTER TABLE public.deals DISABLE TRIGGER trg_negocio_ganho_vai_para_etapa_won;
ALTER TABLE public.deals DISABLE TRIGGER trg_deal_won_lead_products;
ALTER TABLE public.deals DISABLE TRIGGER relacao_after_deal;

SELECT has_trigger('public', 'deals', 'a_trg_exige_valor_no_negocio',
  '(STRUCT) a trava de valor existe em deals');

-- ── (ANTES) org poupada ─────────────────────────────────────────────────────
SELECT lives_ok(
  $q$UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'b0114a00-0000-4000-8000-0000000000d1'$q$,
  '(ANTES) org poupada ganha negócio sem valor');

-- ── Religar: o MESMO UPDATE da migration, sobre a org de fixture ───────────
UPDATE public.rollout_exige_valor_venda
   SET religado_em = now()
 WHERE organization_id = 'b0114a00-0000-4000-8000-0000000000a1'
   AND religado_em IS NULL;

SELECT isnt(
  (SELECT religado_em FROM public.rollout_exige_valor_venda
    WHERE organization_id = 'b0114a00-0000-4000-8000-0000000000a1'),
  NULL::timestamptz,
  '(RELIGAR) religado_em foi marcado');

-- ── (DEPOIS) ────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $q$UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'b0114a00-0000-4000-8000-0000000000d2'$q$,
  '23514',
  'Informe o valor antes de marcar o negócio como ganho.',
  '(DEPOIS) religada: ganhar sem valor é recusado');

SELECT isnt(
  (SELECT outcome FROM public.deals WHERE id = 'b0114a00-0000-4000-8000-0000000000d2'),
  'won',
  '(DEPOIS) e o negócio recusado não vira ganho');

-- ── (RECUPERA) ──────────────────────────────────────────────────────────────
SELECT lives_ok(
  $q$UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'b0114a00-0000-4000-8000-0000000000d3'$q$,
  '(RECUPERA) valor só na entrada do funil não é recusado');

SELECT is(
  (SELECT value FROM public.deals WHERE id = 'b0114a00-0000-4000-8000-0000000000d3'),
  250.50::numeric,
  '(RECUPERA) o valor da entrada vira o valor do negócio');

-- ── (ZERO) ──────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $q$UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'b0114a00-0000-4000-8000-0000000000d4'$q$,
  '(ZERO) valor 0 é resposta válida');

-- ── (FORA) ──────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $q$UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'b0114a00-0000-4000-8000-0000000000d5'$q$,
  '(FORA) outra org poupada segue passando sem valor');

SELECT * FROM finish();
ROLLBACK;
