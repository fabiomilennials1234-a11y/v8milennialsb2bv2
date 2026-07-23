-- Campaign Objectives: adds strategic objective to campaigns
-- Determines the success destination (pipe + stage) automatically.
-- Objectives: qualificacao, agendamentos, propostas, livre
-- 'livre' requires explicit free_target_pipe and free_target_stage.

-- 1. Add objective column with default 'livre' for existing campaigns
ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS objective TEXT NOT NULL DEFAULT 'livre'
  CONSTRAINT chk_objective CHECK (objective IN ('qualificacao', 'agendamentos', 'propostas', 'livre'));

-- 2. Add free target columns for 'livre' objective
ALTER TABLE public.campanhas
  ADD COLUMN IF NOT EXISTS free_target_pipe TEXT
  CONSTRAINT chk_free_target_pipe CHECK (free_target_pipe IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')),
  ADD COLUMN IF NOT EXISTS free_target_stage TEXT;

-- 3. Integrity constraint: 'livre' requires pipe+stage, others must be NULL
-- NOTE: existing campaigns with objective='livre' may not have pipe/stage yet,
-- so we allow NULL for 'livre' too (enforced in application layer for new campaigns).
-- Non-livre objectives MUST have NULL free_target fields.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_free_target_consistency'
  ) THEN
    ALTER TABLE public.campanhas
      ADD CONSTRAINT chk_free_target_consistency
      CHECK (
        objective = 'livre'
        OR (free_target_pipe IS NULL AND free_target_stage IS NULL)
      );
  END IF;
END $$;

-- 4. Comment for documentation
COMMENT ON COLUMN public.campanhas.objective IS
  'Strategic campaign objective: qualificacao (→ pipe_whatsapp), agendamentos (→ pipe_confirmacao), propostas (→ pipe_propostas), livre (→ free_target_pipe/stage)';
COMMENT ON COLUMN public.campanhas.free_target_pipe IS
  'Target pipe for livre objective campaigns. Must be NULL for other objectives.';
COMMENT ON COLUMN public.campanhas.free_target_stage IS
  'Target stage/status for livre objective campaigns. Must be NULL for other objectives.';
