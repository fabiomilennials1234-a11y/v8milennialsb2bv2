-- Rollback de 20270302000020_pipeline_stages_stage_role_suggestions.sql (#991)
--
-- Remove as colunas de sugestão do Stage Role Classifier. Não toca em
-- `stage_role` (#990) — roles já aplicados (auto-aplicados ou confirmados)
-- permanecem; só a fila pendente e a trilha de sugestão são perdidas.

DROP INDEX IF EXISTS public.idx_pipeline_stages_pending_role_suggestion;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_suggested_role_not_open,
  DROP CONSTRAINT IF EXISTS pipeline_stages_suggestion_source_valid;

ALTER TABLE public.pipeline_stages
  DROP COLUMN IF EXISTS suggested_stage_role,
  DROP COLUMN IF EXISTS stage_role_suggested_at,
  DROP COLUMN IF EXISTS stage_role_suggestion_source,
  DROP COLUMN IF EXISTS stage_role_reviewed_at,
  DROP COLUMN IF EXISTS stage_role_reviewed_by;
