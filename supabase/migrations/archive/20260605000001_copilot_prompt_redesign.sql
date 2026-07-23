-- Copilot Prompt Redesign Phase 1
-- Adds objective_composite, custom_instructions, and prompt_hash to copilot_agents
-- Date: 2026-02-17

-- 1. Composite objective: replaces single main_objective string with structured 3-part object
-- Structure: { mission: string, success_criteria: string, limits: string }
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS objective_composite JSONB DEFAULT NULL;

-- 2. Custom instructions: free-form user rules appended to the end of the prompt
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS custom_instructions TEXT DEFAULT NULL;

-- 3. Prompt hash: tracks which config version the cached system_prompt was built from
ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT DEFAULT NULL;

-- 4. Migrate existing agents: populate objective_composite from main_objective
UPDATE public.copilot_agents
SET objective_composite = jsonb_build_object(
  'mission', COALESCE(main_objective, ''),
  'success_criteria', '',
  'limits', ''
)
WHERE objective_composite IS NULL
  AND main_objective IS NOT NULL
  AND main_objective != '';

-- 5. Comments
COMMENT ON COLUMN public.copilot_agents.objective_composite IS 'Objetivo estruturado em 3 partes: mission (o que fazer), success_criteria (quando deu certo), limits (o que não fazer)';
COMMENT ON COLUMN public.copilot_agents.custom_instructions IS 'Instruções personalizadas do usuário. Adicionadas ao final do system prompt.';
COMMENT ON COLUMN public.copilot_agents.prompt_hash IS 'Hash dos campos que afetam o prompt. Usado para detectar quando o cache precisa ser regenerado.';
