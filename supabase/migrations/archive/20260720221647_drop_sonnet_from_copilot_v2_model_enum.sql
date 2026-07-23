-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260720221647  name: drop_sonnet_from_copilot_v2_model_enum
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Copilot v2: remove anthropic/claude-sonnet-4-6 do enum de modelos e adiciona
-- openai/gpt-4.1-mini (novo modelo do arquetipo Vendedor).
--
-- Postgres nao permite DROP de valor de enum -> recria o tipo e faz swap da coluna.
-- Seguro: copilot_v2_agents tem 1 linha, em google/gemini-2.5-flash (nenhuma em Sonnet).
--
-- Par obrigatorio com _shared/copilot-v2/model-selector.ts (MODEL_BY_ARCHETYPE).

CREATE TYPE public.copilot_v2_model_id_new AS ENUM (
  'google/gemini-2.5-flash',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4.1-mini'
);

ALTER TABLE public.copilot_v2_agents
  ALTER COLUMN model_id DROP DEFAULT;

ALTER TABLE public.copilot_v2_agents
  ALTER COLUMN model_id TYPE public.copilot_v2_model_id_new
  USING model_id::text::public.copilot_v2_model_id_new;

DROP TYPE public.copilot_v2_model_id;

ALTER TYPE public.copilot_v2_model_id_new RENAME TO copilot_v2_model_id;

ALTER TABLE public.copilot_v2_agents
  ALTER COLUMN model_id SET DEFAULT 'google/gemini-2.5-flash'::public.copilot_v2_model_id;
