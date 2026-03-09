-- Set default natural_messaging_config for all existing agents that don't have it
-- This ensures natural messaging is always active (intensity: natural)
UPDATE copilot_agents
SET natural_messaging_config = '{"enabled": true, "intensity": "natural"}'::jsonb
WHERE natural_messaging_config IS NULL;

-- Also update the default for new agents
ALTER TABLE copilot_agents
ALTER COLUMN natural_messaging_config SET DEFAULT '{"enabled": true, "intensity": "natural"}'::jsonb;
