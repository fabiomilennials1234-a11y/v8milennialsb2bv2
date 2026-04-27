-- Add TTS config to copilot_agents
ALTER TABLE copilot_agents
ADD COLUMN IF NOT EXISTS tts_config JSONB DEFAULT NULL;

COMMENT ON COLUMN copilot_agents.tts_config IS
'TTS config via ElevenLabs: {provider, voice_id, mode, max_chars, model_id, stability, similarity_boost}. NULL = disabled.';

-- Add ElevenLabs API key to organizations
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT DEFAULT NULL;

-- RLS: Only org admins can read/update the elevenlabs_api_key column.
-- Since RLS operates at row level, we use a security definer function to check admin role
-- and restrict the column in application code (edge functions + frontend).
-- The key is primarily read server-side by edge functions using service_role_key,
-- and saved by the frontend via direct update (restricted to admin role in the component).
-- For additional safety, the elevenlabs-proxy edge function verifies admin role before using the key.
