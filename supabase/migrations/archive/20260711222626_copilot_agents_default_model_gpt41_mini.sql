-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260711222626  name: copilot_agents_default_model_gpt41_mini
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Novos copilots devem nascer em openai/gpt-4.1-mini.
-- Default anterior era 'google/gemini-3-flash-preview' (modelo preview instável,
-- causa-raiz do leak <prefill> / tool-call-como-texto — incidentes Forever Bella
-- 2026-07-11 e 2026-05-21). gpt-4.1-mini: tool-calling nativo disciplinado.
alter table public.copilot_agents
  alter column llm_model set default 'openai/gpt-4.1-mini';
