-- supabase/tests/negocio_ganho_vai_para_etapa_won_test.sql
--
-- Migration 20271021000039 — negócio ganho vai para a etapa de ganho do funil.
--
-- O que a suíte prova:
--   (MOVE)      outcome → won leva o card para a 1ª etapa ATIVA `won` do funil.
--   (CADERNO)   a movimentação NÃO grava segunda venda — exatamente 1 `sale`.
--   (SEM-ETAPA) funil sem etapa `won`: o card fica; o ganho vale mesmo assim.
--   (JÁ-LÁ)     card que já está em etapa `won` não gera evento de etapa novo.
--   (VALOR)     etapa com `requires_sale_value` recebe `deals.value` no metadata.
--   (PODADO)    trava da etapa recusa → só a posição volta; o ganho fica.
--   (INATIVA)   etapa `won` inativa é ignorada.
--   (PRIORIDADE) funil com etapa `won` E etapa de sucesso: vence a `won`.
--   (SUCESSO)   sem `won`, vai para a etapa de sucesso MAIS ADIANTADA.
--   (REUNIÃO)   sucesso com papel de reunião NÃO recebe o card.
--   (SUCESSO-JÁ) card já numa etapa de sucesso elegível não gera evento.
--   (KANBAN)    get_pipeline_page projeta `metadata.deal_outcome`.
--
-- ⚠️ Fixtures rodam sob `session_replication_role = replica` (gatilho
-- desligado). As asserções voltam para `origin` antes de exercitar — sem isso
-- a suíte passaria por ausência.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT)
-- ===========================================================================
SELECT has_trigger('public', 'deals', 'trg_negocio_ganho_vai_para_etapa_won',
  '(STRUCT) trigger existe em deals');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE'),
  '(STRUCT) função DEFINER do trigger não é executável por anon/authenticated');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000f001', 'Org Ganho', 'org-ganho', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-00000000f002', 'Org Ganho Poupada', 'org-ganho-poupada', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- Org poupada da trava de valor: pode ganhar negócio SEM valor.
INSERT INTO public.rollout_exige_valor_venda (organization_id, motivo, vendas_6m, pct_sem_valor)
VALUES ('deadbeef-0000-4000-8000-00000000f002', 'fixture', 0, 0)
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-00000000f0a1', 'deadbeef-0000-4000-8000-00000000f001', 'Lead Ganho'),
  ('deadbeef-0000-4000-8000-00000000f0a2', 'deadbeef-0000-4000-8000-00000000f002', 'Lead Poupado')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  -- P1: tem etapa won ativa (e uma won INATIVA antes dela, que tem de ser ignorada).
  ('deadbeef-0000-4000-8000-00000000f0b1', 'deadbeef-0000-4000-8000-00000000f001', 'Com ganho',  'com-ganho',  'custom'),
  -- P2: sem etapa won (71% dos funis em 2026-08-28).
  ('deadbeef-0000-4000-8000-00000000f0b2', 'deadbeef-0000-4000-8000-00000000f001', 'Sem ganho',  'sem-ganho',  'custom'),
  -- P3: etapa won exige valor.
  ('deadbeef-0000-4000-8000-00000000f0b3', 'deadbeef-0000-4000-8000-00000000f001', 'Exige valor', 'exige-valor', 'custom'),
  -- P4: org poupada, etapa won exige valor.
  ('deadbeef-0000-4000-8000-00000000f0b4', 'deadbeef-0000-4000-8000-00000000f002', 'Poupada', 'poupada', 'custom'),
  -- P5: sem won; duas etapas de sucesso sem papel de reunião.
  ('deadbeef-0000-4000-8000-00000000f0b5', 'deadbeef-0000-4000-8000-00000000f001', 'Sucesso',    'sucesso',    'custom'),
  -- P6: sem won; a única etapa de sucesso é de reunião.
  ('deadbeef-0000-4000-8000-00000000f0b6', 'deadbeef-0000-4000-8000-00000000f001', 'Sucesso reunião', 'sucesso-reuniao', 'custom')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active, requires_sale_value, is_final_positive)
VALUES
  ('deadbeef-0000-4000-8000-00000000f1b5', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'custom', 'sucesso_p1',  'Sucesso P1',  4, 'open',           true, false, true),
  ('deadbeef-0000-4000-8000-00000000f5b1', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b5', 'custom', 'proposta',    'Proposta',    0, 'open',           true, false, false),
  ('deadbeef-0000-4000-8000-00000000f5b2', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b5', 'custom', 'qualificado', 'Qualificado', 1, 'open',           true, false, true),
  ('deadbeef-0000-4000-8000-00000000f5b3', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b5', 'custom', 'fechado',     'Fechado',     2, 'open',           true, false, true),
  ('deadbeef-0000-4000-8000-00000000f6b1', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b6', 'custom', 'proposta',    'Proposta',    0, 'open',           true, false, false),
  ('deadbeef-0000-4000-8000-00000000f6b2', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b6', 'custom', 'orcamento',   'Orçamento ✓', 1, 'meeting_booked', true, false, true);

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active, requires_sale_value)
VALUES
  ('deadbeef-0000-4000-8000-00000000f1b1', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'custom', 'proposta',     'Proposta',      0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-00000000f1b2', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'custom', 'ganho_antigo', 'Ganho antigo',  1, 'won',  false, false),
  ('deadbeef-0000-4000-8000-00000000f1b3', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'custom', 'ganhou',       'Ganhou',        2, 'won',  true,  false),
  ('deadbeef-0000-4000-8000-00000000f1b4', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'custom', 'perdeu',       'Perdeu',        3, 'lost', true,  false),
  ('deadbeef-0000-4000-8000-00000000f2b1', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b2', 'custom', 'proposta',     'Proposta',      0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-00000000f3b1', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b3', 'custom', 'proposta',     'Proposta',      0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-00000000f3b2', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b3', 'custom', 'vendido',      'Vendido',       1, 'won',  true,  true),
  ('deadbeef-0000-4000-8000-00000000f4b1', 'deadbeef-0000-4000-8000-00000000f002', 'deadbeef-0000-4000-8000-00000000f0b4', 'custom', 'proposta',     'Proposta',      0, 'open', true,  false),
  ('deadbeef-0000-4000-8000-00000000f4b2', 'deadbeef-0000-4000-8000-00000000f002', 'deadbeef-0000-4000-8000-00000000f0b4', 'custom', 'vendido',      'Vendido',       1, 'won',  true,  true);

INSERT INTO public.deals (id, organization_id, source_lead_id, title, source, value) VALUES
  ('deadbeef-0000-4000-8000-00000000fd01', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Move',       'human', 1000),
  ('deadbeef-0000-4000-8000-00000000fd02', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Sem etapa',  'human', 1000),
  ('deadbeef-0000-4000-8000-00000000fd03', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Já lá',      'human', 1000),
  ('deadbeef-0000-4000-8000-00000000fd04', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Exige',      'human', 1500),
  ('deadbeef-0000-4000-8000-00000000fd05', 'deadbeef-0000-4000-8000-00000000f002', 'deadbeef-0000-4000-8000-00000000f0a2', 'Poupado',    'human', NULL),
  ('deadbeef-0000-4000-8000-00000000fd06', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Sucesso',    'human', 1000),
  ('deadbeef-0000-4000-8000-00000000fd07', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Reunião',    'human', 1000),
  ('deadbeef-0000-4000-8000-00000000fd08', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0a1', 'Sucesso já', 'human', 1000);

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, stage_id, deal_id) VALUES
  ('deadbeef-0000-4000-8000-00000000fe01', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'deadbeef-0000-4000-8000-00000000f0a1', 'proposta', 'deadbeef-0000-4000-8000-00000000f1b1', 'deadbeef-0000-4000-8000-00000000fd01'),
  ('deadbeef-0000-4000-8000-00000000fe02', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b2', 'deadbeef-0000-4000-8000-00000000f0a1', 'proposta', 'deadbeef-0000-4000-8000-00000000f2b1', 'deadbeef-0000-4000-8000-00000000fd02'),
  ('deadbeef-0000-4000-8000-00000000fe03', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b1', 'deadbeef-0000-4000-8000-00000000f0a1', 'ganhou',   'deadbeef-0000-4000-8000-00000000f1b3', 'deadbeef-0000-4000-8000-00000000fd03'),
  ('deadbeef-0000-4000-8000-00000000fe04', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b3', 'deadbeef-0000-4000-8000-00000000f0a1', 'proposta', 'deadbeef-0000-4000-8000-00000000f3b1', 'deadbeef-0000-4000-8000-00000000fd04'),
  ('deadbeef-0000-4000-8000-00000000fe05', 'deadbeef-0000-4000-8000-00000000f002', 'deadbeef-0000-4000-8000-00000000f0b4', 'deadbeef-0000-4000-8000-00000000f0a2', 'proposta', 'deadbeef-0000-4000-8000-00000000f4b1', 'deadbeef-0000-4000-8000-00000000fd05'),
  ('deadbeef-0000-4000-8000-00000000fe06', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b5', 'deadbeef-0000-4000-8000-00000000f0a1', 'proposta', 'deadbeef-0000-4000-8000-00000000f5b1', 'deadbeef-0000-4000-8000-00000000fd06'),
  ('deadbeef-0000-4000-8000-00000000fe07', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b6', 'deadbeef-0000-4000-8000-00000000f0a1', 'proposta', 'deadbeef-0000-4000-8000-00000000f6b1', 'deadbeef-0000-4000-8000-00000000fd07'),
  ('deadbeef-0000-4000-8000-00000000fe08', 'deadbeef-0000-4000-8000-00000000f001', 'deadbeef-0000-4000-8000-00000000f0b5', 'deadbeef-0000-4000-8000-00000000f0a1', 'qualificado', 'deadbeef-0000-4000-8000-00000000f5b2', 'deadbeef-0000-4000-8000-00000000fd08');

-- ===========================================================================
-- A PARTIR DAQUI OS GATILHOS VOLTAM.
-- ===========================================================================
SET LOCAL session_replication_role = origin;

-- ── (MOVE) + (INATIVA) + (CADERNO) ─────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd01';

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe01'),
  'ganhou',
  '(MOVE)(INATIVA)(PRIORIDADE) vai para a won ativa — pula a won inativa e prefere won a sucesso');

SELECT is(
  (SELECT stage_id FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe01'),
  'deadbeef-0000-4000-8000-00000000f1b3'::uuid,
  '(MOVE) stage_id e stage_key andam juntos');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = 'deadbeef-0000-4000-8000-00000000fe01'
      AND from_stage_key = 'proposta' AND to_stage_key = 'ganhou'),
  1,
  '(MOVE) a movimentação fica no histórico de etapas, como qualquer outra');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE deal_id = 'deadbeef-0000-4000-8000-00000000fd01' AND event_type = 'sale'),
  1,
  '(CADERNO) exatamente UMA venda — a movimentação não grava a segunda');

SELECT is(
  (SELECT outcome FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000fd01'),
  'won',
  '(CADERNO) o desfecho segue ganho depois da movimentação');

-- ── (SEM-ETAPA) ─────────────────────────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd02';

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe02'),
  'proposta',
  '(SEM-ETAPA) funil sem etapa won: o card fica onde estava');

SELECT is(
  (SELECT outcome FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000fd02'),
  'won',
  '(SEM-ETAPA) e o ganho vale mesmo assim');

-- ── (JÁ-LÁ) ─────────────────────────────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd03';

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = 'deadbeef-0000-4000-8000-00000000fe03'),
  0,
  '(JÁ-LÁ) card já em etapa won não gera evento de etapa');

-- ── (VALOR) ─────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'deadbeef-0000-4000-8000-00000000fd04' $$,
  '(VALOR) ganhar com deals.value não esbarra na trava da etapa');

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe04'),
  'vendido',
  '(VALOR) card vai para a etapa que exige valor');

SELECT is(
  (SELECT (metadata->>'sale_value')::numeric FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe04'),
  1500::numeric,
  '(VALOR) deals.value chega em metadata.sale_value, onde a trava da etapa olha');

-- `trg_enforce_closed_at` é `UPDATE OF stage_key`: só dispara se a movimentação
-- põe stage_key no SET (não basta o espelho derivá-lo de stage_id).
SELECT isnt(
  (SELECT closed_at FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe04'),
  NULL,
  '(VALOR) gatilhos UPDATE OF stage_key disparam — o card em "vendido" fecha');

-- ── (PODADO) ────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
      WHERE id = 'deadbeef-0000-4000-8000-00000000fd05' $$,
  '(PODADO) org poupada ganha sem valor — a trava da etapa não derruba o ganho');

SELECT is(
  (SELECT outcome FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000fd05'),
  'won',
  '(PODADO) o ganho fica');

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe05'),
  'proposta',
  '(PODADO) só a posição volta: sem valor, o card não entra na etapa que exige');

-- ── (SUCESSO) ───────────────────────────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd06';

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe06'),
  'fechado',
  '(SUCESSO) sem etapa won, vai para a etapa de sucesso mais adiantada');

-- ── (REUNIÃO) ───────────────────────────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd07';

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe07'),
  'proposta',
  '(REUNIÃO) sucesso com papel de reunião não recebe o card — seria reunião fantasma na métrica');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_stage_events
    WHERE entry_id = 'deadbeef-0000-4000-8000-00000000fe07'),
  0,
  '(REUNIÃO) nenhum evento de etapa nasce');

-- ── (SUCESSO-JÁ) ────────────────────────────────────────────────────────────
UPDATE public.deals SET outcome = 'won', outcome_source = 'ui'
 WHERE id = 'deadbeef-0000-4000-8000-00000000fd08';

SELECT is(
  (SELECT stage_key FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000fe08'),
  'qualificado',
  '(SUCESSO-JÁ) card já numa etapa de sucesso fica nela — não pula para a próxima');

-- ── (KANBAN) ────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT metadata->>'deal_outcome'
     FROM public.get_pipeline_page(
       p_stage_id => 'ganhou',
       p_org_id => 'deadbeef-0000-4000-8000-00000000f001',
       p_pipeline_id => 'deadbeef-0000-4000-8000-00000000f0b1')
    WHERE id = 'deadbeef-0000-4000-8000-00000000fe01'),
  'won',
  '(KANBAN) get_pipeline_page projeta metadata.deal_outcome');

SELECT is(
  (SELECT metadata->>'deal_outcome'
     FROM public.get_pipeline_page(
       p_stage_id => 'proposta',
       p_org_id => 'deadbeef-0000-4000-8000-00000000f001',
       p_pipeline_id => 'deadbeef-0000-4000-8000-00000000f0b2')
    WHERE id = 'deadbeef-0000-4000-8000-00000000fe02'),
  'won',
  '(KANBAN) card ganho fora da etapa won também chega marcado — é o que pinta o card de verde');

SELECT * FROM finish();
ROLLBACK;
