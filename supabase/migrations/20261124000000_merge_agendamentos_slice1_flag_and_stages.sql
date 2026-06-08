-- 20261124000000_merge_agendamentos_slice1_flag_and_stages.sql
--
-- Slice 1 do merge Agendamentos → Oportunidades (ADR-0004, PRD #715, issue #716).
--
-- 1. Registra a rollout flag `merged_opportunity_funnel` (default OFF p/ todas orgs).
-- 2. Liga a flag SÓ para a Milennials (rollout fase 1).
-- 3. ANEXA as etapas de reunião ao funil de Oportunidades (whatsapp) da Milennials,
--    SEM tocar nas etapas de qualificação existentes. Espelha a função pura
--    `appendMeetingStages` (src/contracts/pipe/merged-funnel.ts).
--
-- Idempotente: pode rodar 2x sem duplicar (ON CONFLICT DO NOTHING + flip condicional).

-- ── 1. Flag global (default OFF) ────────────────────────────────
INSERT INTO public.feature_flags (key, name, description, category, default_enabled)
VALUES (
  'merged_opportunity_funnel',
  'Funil Oportunidades Consolidado',
  'Mergeia Agendamentos em Oportunidades — anexa etapas de reunião + confirmação por status (ADR-0004)',
  'advanced',
  false
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Liga só para a Milennials (6030520a-2ca7-477d-be89-55758e2cd808) ──
INSERT INTO public.organization_features (organization_id, feature_key, enabled, override_reason)
VALUES (
  '6030520a-2ca7-477d-be89-55758e2cd808',
  'merged_opportunity_funnel',
  true,
  'Rollout fase 1 — merge Agendamentos→Oportunidades (ADR-0004)'
)
ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = true;

-- ── 3. Normaliza `agendado` existente: deixa de ser terminal + handoff ──
UPDATE public.pipeline_stages
SET is_final_positive = false,
    target_pipe_type  = NULL,
    target_stage_key  = NULL,
    updated_at        = NOW()
WHERE organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'
  AND pipeline_type = 'whatsapp'
  AND stage_key = 'agendado';

-- ── 3b. Anexa as etapas de reunião que faltam, posições após o max atual ──
WITH base AS (
  SELECT COALESCE(MAX(position), -1) AS max_pos
  FROM public.pipeline_stages
  WHERE organization_id = '6030520a-2ca7-477d-be89-55758e2cd808'
    AND pipeline_type = 'whatsapp'
)
INSERT INTO public.pipeline_stages
  (organization_id, pipeline_type, stage_key, name, color, position, is_final_positive, is_final_negative)
SELECT
  '6030520a-2ca7-477d-be89-55758e2cd808', 'whatsapp', s.stage_key, s.name, s.color,
  base.max_pos + s.pos_off, s.is_final_positive, s.is_final_negative
FROM base
CROSS JOIN (VALUES
  -- agendado já existe no default whatsapp; incluído aqui só p/ orgs que não o tenham
  ('agendado',       'Agendado',        '#6366f1', 1, false, false),
  ('remarcar',       'Remarcar',        '#f97316', 2, false, false),
  ('compareceu',     'Compareceu',      '#22c55e', 3, true,  false),
  ('nao_compareceu', 'Não compareceu',  '#ef4444', 4, false, true )
) AS s(stage_key, name, color, pos_off, is_final_positive, is_final_negative)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;
