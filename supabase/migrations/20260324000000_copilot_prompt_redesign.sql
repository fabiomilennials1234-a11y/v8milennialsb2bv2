-- =============================================================
-- Migration: Copilot Prompt Redesign
-- Adiciona suporte a objetivo composto, instruções personalizadas
-- e hash do prompt para detecção de mudanças.
-- =============================================================

-- Objetivo composto (substitui main_objective single string)
-- Estrutura: { mission, success_criteria, limits }
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS objective_composite JSONB DEFAULT NULL;

-- Instruções personalizadas do usuário
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS custom_instructions TEXT DEFAULT NULL;

-- Hash para detectar mudanças e evitar regenerações desnecessárias
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT DEFAULT NULL;

-- Migrar dados existentes: popular objective_composite a partir de main_objective
UPDATE public.copilot_agents
SET objective_composite = jsonb_build_object(
  'mission', main_objective,
  'success_criteria', '',
  'limits', ''
)
WHERE objective_composite IS NULL
  AND main_objective IS NOT NULL
  AND main_objective != '';
