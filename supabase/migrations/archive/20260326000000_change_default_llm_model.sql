-- =============================================================
-- Migration: Trocar default llm_model para openai/gpt-4o-mini
-- Todos os agentes devem usar gpt-4o-mini como padrão.
-- =============================================================

-- Alterar default da coluna
ALTER TABLE public.copilot_agents
  ALTER COLUMN llm_model SET DEFAULT 'openai/gpt-4o-mini';

-- Atualizar agentes existentes que usam o antigo default
UPDATE public.copilot_agents
SET llm_model = 'openai/gpt-4o-mini'
WHERE llm_model = 'anthropic/claude-3.5-sonnet';
