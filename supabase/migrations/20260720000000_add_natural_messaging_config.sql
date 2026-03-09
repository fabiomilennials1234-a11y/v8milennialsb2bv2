-- Add natural_messaging_config column to copilot_agents
-- Enables message splitting for more natural WhatsApp conversations
ALTER TABLE copilot_agents
ADD COLUMN IF NOT EXISTS natural_messaging_config jsonb DEFAULT NULL;

COMMENT ON COLUMN copilot_agents.natural_messaging_config IS 'Config for natural message splitting: { enabled: bool, intensity: suave|natural|conversacional }';
