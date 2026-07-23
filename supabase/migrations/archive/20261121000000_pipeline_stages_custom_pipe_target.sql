-- =============================================
-- Migration: Transição de etapa de sucesso (pipe padrão) para funil customizado
-- Espelha custom_pipeline_stages: adiciona target_pipeline_id/target_stage_id
-- em pipeline_stages, permitindo que a etapa de sucesso de um pipe PADRÃO
-- envie o lead para um funil CUSTOMIZADO da org (não só para outro pipe padrão).
--
-- Modelo de destino (mutuamente exclusivo):
--   custom   → target_pipeline_id + target_stage_id
--   standard → target_pipe_type   + target_stage_key
-- =============================================

-- 1. Colunas de destino customizado (FK para tabelas custom)
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS target_pipeline_id UUID
    REFERENCES public.custom_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_stage_id UUID
    REFERENCES public.custom_pipeline_stages(id) ON DELETE SET NULL;

-- 2. Índice parcial — só linhas que apontam para um funil custom
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_target_pipeline
  ON public.pipeline_stages(target_pipeline_id)
  WHERE target_pipeline_id IS NOT NULL;

-- 3. Constraint: destino é custom XOR standard (nunca os dois pares juntos).
--    Mantém NULL/NULL válido (sem transição). Espelha chk_target de
--    custom_pipe_transitions.
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS chk_pipeline_stages_target_exclusive;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT chk_pipeline_stages_target_exclusive CHECK (
    NOT (target_pipeline_id IS NOT NULL AND target_pipe_type IS NOT NULL)
  );

COMMENT ON COLUMN public.pipeline_stages.target_pipeline_id IS
  'Funil customizado de destino ao atingir etapa de sucesso. Mutuamente exclusivo com target_pipe_type.';
COMMENT ON COLUMN public.pipeline_stages.target_stage_id IS
  'Etapa do funil customizado de destino. Usado junto com target_pipeline_id.';
