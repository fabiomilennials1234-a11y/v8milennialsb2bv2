-- Item #7: Temperatura do LLM configurável no wizard
-- Criativo (0.9) | Balanceado (0.7) | Preciso (0.2)

ALTER TABLE copilot_agents
  ADD COLUMN IF NOT EXISTS llm_temperature_mode text
    DEFAULT 'balanceado'
    CHECK (llm_temperature_mode IN ('criativo', 'balanceado', 'preciso'));

COMMENT ON COLUMN copilot_agents.llm_temperature_mode IS
  'Modo de temperatura do LLM: criativo=0.9, balanceado=0.7, preciso=0.2';
