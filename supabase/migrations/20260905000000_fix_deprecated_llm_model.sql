-- =============================================================
-- Migration: Fix deprecated LLM model (openai/gpt-4o-mini removed from OpenRouter)
--
-- OpenAI gpt-4o series was removed from OpenRouter after GPT-5 launch.
-- All agents using the old default get updated to google/gemini-3-flash-preview
-- which is already the hardcoded fallback throughout the codebase.
-- =============================================================

-- Update all agents still using the deprecated model
UPDATE public.copilot_agents
SET llm_model = 'google/gemini-3-flash-preview'
WHERE llm_model = 'openai/gpt-4o-mini';

-- Change column default for new agents
ALTER TABLE public.copilot_agents
  ALTER COLUMN llm_model SET DEFAULT 'google/gemini-3-flash-preview';
