-- Add handoff WhatsApp notification columns to copilot_agents.
-- When handoff_notify_phones is non-empty, the system sends a WhatsApp
-- notification to those numbers upon transfer-to-human, using the same
-- WhatsApp instance connected to the agent.

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS handoff_notify_phones text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS handoff_notify_instructions text DEFAULT NULL;

COMMENT ON COLUMN public.copilot_agents.handoff_notify_phones IS
  'WhatsApp numbers to notify when agent transfers conversation to human. Non-empty = feature active.';
COMMENT ON COLUMN public.copilot_agents.handoff_notify_instructions IS
  'Natural language instructions for notification routing (e.g. "If order > R$5k, notify manager")';
