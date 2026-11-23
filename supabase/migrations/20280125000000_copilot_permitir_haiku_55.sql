-- Habilita a seleção de Haiku por agente. A troca dos agentes é uma etapa
-- operacional depois da validação do modelo no motor de atendimento.
ALTER TABLE public.copilot_agents
  DROP CONSTRAINT copilot_agents_llm_model_allowlist,
  ADD CONSTRAINT copilot_agents_llm_model_allowlist
    CHECK (llm_model IN ('openai/gpt-4.1-mini', 'anthropic/claude-haiku-5.5'));

COMMENT ON CONSTRAINT copilot_agents_llm_model_allowlist ON public.copilot_agents IS
  'Modelos aprovados para o Copilot v1. Novos modelos exigem alteração auditável desta restrição.';
