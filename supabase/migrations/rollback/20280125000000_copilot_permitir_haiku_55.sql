BEGIN;

UPDATE public.copilot_agents
   SET llm_model = 'openai/gpt-4.1-mini'
 WHERE llm_model = 'anthropic/claude-haiku-5.5';

ALTER TABLE public.copilot_agents
  DROP CONSTRAINT copilot_agents_llm_model_allowlist,
  ADD CONSTRAINT copilot_agents_llm_model_allowlist
    CHECK (llm_model = 'openai/gpt-4.1-mini');

COMMENT ON CONSTRAINT copilot_agents_llm_model_allowlist ON public.copilot_agents IS
  'Allowlist de modelos aprovados para Copilot v1. Adicionar modelo = nova migration.';

COMMIT;
