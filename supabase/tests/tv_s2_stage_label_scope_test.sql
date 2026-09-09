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
ON CONFLICT (pipeline_id, stage_key) DO NOTHING;

-- Pipeline CUSTOM (type='custom'): entries em pipeline_entries, stages em
-- custom_pipeline_stages por pipeline_id (pipelines.id==custom_pipelines.id).
-- Medido em prod: 13.916 entries custom resolvem por essa chave.
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('e2a52000-0000-4000-8000-0000000000c1', 'e2a52000-0000-4000-8000-000000000001', 'Meu Funil', 'meu-funil', 'custom')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.pipeline_stages (organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000c1', 'proposta_x', 'Proposta Enviada', 0, (SELECT (enum_range(NULL::public.stage_role))[1]))
ON CONFLICT (pipeline_id, stage_key) DO NOTHING;

-- Entries abertas: 2 em 'novo' (sistema), 1 em 'compareceu' (sistema), 1 custom.
INSERT INTO public.pipeline_entries (organization_id, pipeline_id, stage_key, closed_at)
VALUES
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'novo',       NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'novo',       NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000a1', 'compareceu', NULL),
  ('e2a52000-0000-4000-8000-000000000001', 'e2a52000-0000-4000-8000-0000000000c1', 'proposta_x', NULL);

UPDATE public.pipeline_stages SET pipeline_id = 'e2a52000-0000-4000-8000-0000000000a1'
WHERE organization_id = 'e2a52000-0000-4000-8000-000000000001' AND pipeline_type = 'whatsapp';
UPDATE public.pipeline_entries e SET stage_id = s.id
FROM public.pipeline_stages s
WHERE e.organization_id = 'e2a52000-0000-4000-8000-000000000001'
  AND s.organization_id = e.organization_id AND s.pipeline_id = e.pipeline_id
  AND s.stage_key = e.stage_key;

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
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'negocio') ->> 'value'),
  NULL::text, '(MULTI) etapa sem escopo retorna série; não degrada para total');
SELECT ok(
  jsonb_array_length(public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'negocio') -> 'series') = 3,
  '(MULTI) três baldes distintos por funil e etapa, sem somar funis diferentes');

-- ===========================================================================
-- (RÓTULO) etapa COM pipeline → série com NOME HUMANO, nunca stage-key cru
-- ===========================================================================
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'negocio') -> 'series')
   @> '[{"label":"Novo Lead"}]'::jsonb,
  '(RÓTULO) etapa escopada: label = "Novo Lead" (humano)');
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'negocio') -> 'series')
   @> '[{"label":"Compareceu","value":1}]'::jsonb,
  '(RÓTULO) etapa escopada: "Compareceu" com value correto');
-- Nenhum label é a stage-key crua.
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(
     public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
       '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb, 'negocio') -> 'series') s
   WHERE s->>'label' IN ('novo','compareceu')),
  0, '(RÓTULO) NENHUM label é stage-key crua (novo/compareceu)');

-- etapa escopada num pipeline CUSTOM → nome humano da etapa custom.
SELECT ok(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa',
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000c1"}'::jsonb, 'negocio') -> 'series')
   @> '[{"label":"Proposta Enviada","value":1}]'::jsonb,
  '(CUSTOM) etapa escopada em pipeline custom: label humano "Proposta Enviada"');

-- SINAL de degradação (#1254 volta 2): quem degrada CONTA que degradou.
SELECT is(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'etapa', '{}'::jsonb, 'negocio') ->> 'effective_recorte'),
  NULL::text, '(SINAL) não há sinal de degradação: a série por etapa existe');
SELECT is(
  (public._metric_leaf('e2a52000-0000-4000-8000-000000000001', 'leads_na_etapa', 'etapa', 'month', NULL, NULL, NULL, '{}'::jsonb) ->> 'recorte'),
  'etapa', '(SINAL) _metric_leaf preserva recorte por etapa mesmo sem funil escolhido');
SELECT is(
  (public._metric_leaf('e2a52000-0000-4000-8000-000000000001', 'leads_na_etapa', 'etapa', 'month', NULL, NULL, NULL,
     '{"pipeline_id":"e2a52000-0000-4000-8000-0000000000a1"}'::jsonb) ->> 'recorte'),
  'etapa', '(SINAL) escopado mantém recorte=etapa (série real, "por Etapa" é honesto)');

-- total continua total.
SELECT is(
  (public._metric_leaf_stage_snapshot('e2a52000-0000-4000-8000-000000000001', 'total', '{}'::jsonb, 'negocio') ->> 'value'),
  '4', '(TOTAL) recorte total inalterado');

SELECT * FROM finish();
ROLLBACK;
