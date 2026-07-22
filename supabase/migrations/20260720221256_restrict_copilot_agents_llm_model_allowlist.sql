-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260720221256  name: restrict_copilot_agents_llm_model_allowlist
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Copilot v1: trava llm_model num allowlist explicito.
-- Motivo: um agente (Bia / Forever Bella) rodava em anthropic/claude-sonnet-4-6,
-- ~5x o custo por token do padrao, sem decisao registrada. Decisao do CTO em
-- 2026-07-20: padronizar em gpt-4.1-mini e impedir criacao fora do allowlist.
-- Para aprovar um modelo novo: nova migration alterando esta constraint (auditavel).

ALTER TABLE public.copilot_agents
  DROP CONSTRAINT IF EXISTS copilot_agents_llm_model_allowlist;

ALTER TABLE public.copilot_agents
  ADD CONSTRAINT copilot_agents_llm_model_allowlist
  CHECK (llm_model IN ('openai/gpt-4.1-mini'));

ALTER TABLE public.copilot_agents
  ALTER COLUMN llm_model SET DEFAULT 'openai/gpt-4.1-mini';

ALTER TABLE public.copilot_agents
  ALTER COLUMN llm_model SET NOT NULL;

COMMENT ON CONSTRAINT copilot_agents_llm_model_allowlist ON public.copilot_agents IS
  'Allowlist de modelos aprovados para Copilot v1. Adicionar modelo = nova migration.';
