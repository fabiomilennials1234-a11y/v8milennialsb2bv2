-- supabase/tests/tv_s2_stage_label_scope_test.sql
--
-- #1254 S2 — o motor devolve rótulo HUMANO de etapa + degrada etapa-sem-escopo
-- para total. Área frágil (leitura da parede viva). Diagnóstico: Bancada (36
-- etapas c/ stage-key cru em prod). ZERO EXECUTE preservado.
--
-- Run: supabase db reset && bash supabase/tests/run.sh (na branch efêmera).
-- Transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;   -- fixtures sem triggers/FK

INSERT INTO public.organizations (id, name, slug, timezone, composable_metrics_enabled)
VALUES ('e2a52000-0000-4000-8000-000000000001', 'QA S2', 'qa-s2', 'America/Sao_Paulo', true)
ON CONFLICT (id) DO NOTHING;

-- Pipeline de SISTEMA (type='system', slug='whatsapp'). O helper liga
-- pipeline_stages.pipeline_type = pipelines.slug (canônico do baseline).
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('e2a52000-0000-4000-8000-0000000000a1', 'e2a52000-0000-4000-8000-000000000001', 'WhatsApp', 'whatsapp', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES
  ('e2a52000-0000-4000-8000-000000000001', 'whatsapp', 'novo',       'Novo Lead',  0, (SELECT (enum_range(NULL::public.stage_role))[1])),
  ('e2a52000-0000-4000-8000-000000000001', 'whatsapp', 'compareceu', 'Compareceu', 1, (SELECT (enum_range(NULL::public.stage_role))[1]))
ON CONFLICT DO NOTHING;

-- Pipeline CUSTOM (type='custom'): entries em pipeline_entries, stages em
-- custom_pipeline_stages por pipeline_id (pipelines.id==custom_pipelines.id).
-- Medido em prod: 13.916 entries custom resolvem por essa chave.
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('e2a52000-0000-4000-8000-0000000000c1', 'e2a52000-0000-4000-8000-000000000001', 'Meu Funil', 'meu-funil', 'custom')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.custom_pipeline_stages (organization_id, pipeline_id, stage_key, name, stage_role)
VALUES ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000c1', 'proposta_x', 'Proposta Enviada', (SELECT (enum_range(NULL::public.stage_role))[1]))
ON CONFLICT DO NOTHING;

-- Entries abertas: 2 em 'novo' (sistema), 1 em 'compareceu' (sistema), 1 custom.
INSERT INTO public.pipeline_entries (organization_id, pipeline_id, stage_key, closed_at)
VALUES
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'novo',       NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'novo',       NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'compareceu', NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000c1', 'proposta_x', NULL);

SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role postgres;

-- ===========================================================================
-- (HELPER) resolve stage_key → nome humano
-- ===========================================================================
SELECT is(public._stage_key_label('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'novo'),
  'Novo Lead', '(HELPER) sistema: stage_key vira nome humano (ligado por slug)');
SELECT is(public._stage_key_label('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000c1', 'proposta_x'),
  'Proposta Enviada', '(HELPER) custom: resolve por pipeline_id (13.916 entries em prod)');
SELECT is(public._stage_key_label('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'inexistente'),
  'inexistente', '(HELPER) fallback: chave crua quando não há nome (nunca NULL)');

-- ===========================================================================
-- (DEGRADA) etapa SEM pipeline → total (não soma etapas de funis distintos)
-- ===========================================================================
SELECT is(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'lead') ->> 'value'),
  '4', '(DEGRADA) etapa sem escopo → value = total (4: 3 sistema + 1 custom), não série');
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'lead') -> 'series') IS NULL
  OR (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'lead') ->> 'series') IS NULL,
  '(DEGRADA) etapa sem escopo NÃO devolve série (zero rótulo cru na parede)');

-- ===========================================================================
-- (RÓTULO) etapa COM pipeline → série com NOME HUMANO, nunca stage-key cru
-- ===========================================================================
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'lead') -> 'series')
   @> '[{"label":"Novo Lead"}]'::jsonb,
  '(RÓTULO) etapa escopada: label = "Novo Lead" (humano)');
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'lead') -> 'series')
   @> '[{"label":"Compareceu","value":1}]'::jsonb,
  '(RÓTULO) etapa escopada: "Compareceu" com value correto');
-- Nenhum label é a stage-key crua.
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(
     public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
       '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'lead') -> 'series') s
   WHERE s->>'label' IN ('novo','compareceu')),
  0, '(RÓTULO) NENHUM label é stage-key crua (novo/compareceu)');

-- etapa escopada num pipeline CUSTOM → nome humano da etapa custom.
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000c1"}'::jsonb, 'lead') -> 'series')
   @> '[{"label":"Proposta Enviada","value":1}]'::jsonb,
  '(CUSTOM) etapa escopada em pipeline custom: label humano "Proposta Enviada"');

-- SINAL de degradação (#1254 volta 2): quem degrada CONTA que degradou.
SELECT is(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'lead') ->> 'effective_recorte'),
  'total', '(SINAL) leaf sinaliza effective_recorte=total ao degradar');
SELECT is(
  (public._metric_leaf('e2a52000-0000-4000-8000-000000000001', 'leads_na_etapa', 'etapa', 'month', NULL, NULL, NULL, '{}'::jsonb) ->> 'recorte'),
  'total', '(SINAL) _metric_leaf devolve recorte=total no degrade → front dropa "por Etapa" e vira número');
SELECT is(
  (public._metric_leaf('e2a52000-0000-4000-8000-000000000001', 'leads_na_etapa', 'etapa', 'month', NULL, NULL, NULL,
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb) ->> 'recorte'),
  'etapa', '(SINAL) escopado mantém recorte=etapa (série real, "por Etapa" é honesto)');

-- total continua total.
SELECT is(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'total', '{}'::jsonb, 'lead') ->> 'value'),
  '4', '(TOTAL) recorte total inalterado');

SELECT * FROM finish();
ROLLBACK;
