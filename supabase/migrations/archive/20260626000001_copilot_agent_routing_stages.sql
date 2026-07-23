-- Item #4: Roteamento de agente por etapa do lead
-- Adiciona routing_stages para definir em quais etapas do pipe este agente deve ser acionado

ALTER TABLE copilot_agents
  ADD COLUMN IF NOT EXISTS routing_stages text[] DEFAULT '{}';

-- Índice para pesquisa por contains() eficiente
CREATE INDEX IF NOT EXISTS idx_copilot_agents_routing_stages
  ON copilot_agents USING GIN (routing_stages);

COMMENT ON COLUMN copilot_agents.routing_stages IS
  'Etapas do pipe_whatsapp que ativam este agente. Vazio = nunca roteado por etapa. Apenas o agente is_default=true é usado como fallback.';
