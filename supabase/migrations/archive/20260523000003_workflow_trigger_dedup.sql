-- workflow trigger dedup — janela configurável + chave determinística.
--
-- Origem: investigação Bertin 2026-05-22. Workflow `c60fd533` (Disparo 1
-- Qualific.) rodou 142x para 78 leads únicos — alguns leads dispararam até
-- 7x. Dedup existente em workflow-trigger.ts só verifica "execução ativa"
-- (não bloqueia reexec após completion).
--
-- Adiciona:
--   - workflows.dedup_window_seconds (default 60) — janela configurável.
--   - workflow_executions.trigger_dedup_key — chave determinística por
--     (trigger_type, payload, window bucket). Caller (workflow-trigger.ts)
--     computa via computeTriggerDedupKey (_shared/workflow-trigger-dedup.ts).
--   - Partial unique (workflow_id, lead_id, trigger_dedup_key) — ON CONFLICT
--     DO NOTHING vira noop quando duplicado.

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS dedup_window_seconds integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.workflows.dedup_window_seconds IS
  'Janela em segundos para dedup de trigger event. Mesma (workflow, lead, trigger_payload) só reexecuta após essa janela. Default 60s.';

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS trigger_dedup_key text;

COMMENT ON COLUMN public.workflow_executions.trigger_dedup_key IS
  'Chave determinística trigger_type:hash(payload):window_bucket. Caller computa via computeTriggerDedupKey (_shared/workflow-trigger-dedup.ts). Partial unique impede reexec duplicado.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_executions_dedup_partial
  ON public.workflow_executions (workflow_id, lead_id, trigger_dedup_key)
  WHERE trigger_dedup_key IS NOT NULL AND lead_id IS NOT NULL;
