-- Item #12: Multi-agente por canal/segmento
-- Adiciona colunas de roteamento por origem e segmento do lead

ALTER TABLE copilot_agents
  ADD COLUMN IF NOT EXISTS routing_origins  text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS routing_segments text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_copilot_agents_routing_origins
  ON copilot_agents USING GIN (routing_origins);

CREATE INDEX IF NOT EXISTS idx_copilot_agents_routing_segments
  ON copilot_agents USING GIN (routing_segments);

COMMENT ON COLUMN copilot_agents.routing_origins IS
  'Origens do lead (ex: meta_ads, google_ads, whatsapp) que ativam este agente. Vazio = não filtra por origem.';

COMMENT ON COLUMN copilot_agents.routing_segments IS
  'Segmentos do lead (ex: enterprise, smb, retail) que ativam este agente. Vazio = não filtra por segmento.';
