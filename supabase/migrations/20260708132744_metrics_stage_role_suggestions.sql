-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708132744  name: metrics_stage_role_suggestions
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000020 (#991, ADR-0017 §1)
ALTER TABLE public.pipeline_stages
  ADD COLUMN suggested_stage_role public.stage_role,
  ADD COLUMN stage_role_suggested_at timestamptz,
  ADD COLUMN stage_role_suggestion_source text,
  ADD COLUMN stage_role_reviewed_at timestamptz,
  ADD COLUMN stage_role_reviewed_by uuid;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_suggested_role_not_open
    CHECK (suggested_stage_role IS DISTINCT FROM 'open'),
  ADD CONSTRAINT pipeline_stages_suggestion_source_valid
    CHECK (stage_role_suggestion_source IS NULL OR stage_role_suggestion_source IN ('deterministic','ai','flag'));

COMMENT ON COLUMN public.pipeline_stages.suggested_stage_role IS '#991 / ADR-0017 §1 — sugestão PENDENTE do Stage Role Classifier. Só won/lost persistem aqui (meeting_* auto-aplicam em stage_role). Limpa na revisão humana. NUNCA é input de métrica.';

CREATE INDEX idx_pipeline_stages_pending_role_suggestion
  ON public.pipeline_stages (organization_id)
  WHERE suggested_stage_role IS NOT NULL;
