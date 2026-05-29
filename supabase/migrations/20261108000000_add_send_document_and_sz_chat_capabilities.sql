-- Add the two capability toggle columns the Copilot Playground persists but
-- that were never created by a migration: can_send_document and
-- can_transfer_sz_chat. The frontend insert (CopilotPlayground.tsx) writes both,
-- so saving any agent fails with PostgREST:
--   "Could not find the 'can_send_document' column of 'copilot_agents'
--    in the schema cache"
--
-- These mirror the existing can_* capability columns. Backend tool gating in
-- agent-message/engine/build-tools.ts currently exposes send_document /
-- transfer_sz_chat based on data existence (KB documents / sz_chat_config), not
-- on these flags — so for now they are UI-facing toggle persistence only.
-- Wiring the backend to honour them is tracked separately.

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_send_document BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_transfer_sz_chat BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.copilot_agents.can_send_document IS
  'Agent capability toggle: send documents/files from the knowledge base via WhatsApp (ENVIAR_DOCUMENTO tool).';
COMMENT ON COLUMN public.copilot_agents.can_transfer_sz_chat IS
  'Agent capability toggle: transfer the conversation to an external SZ.Chat sector (TRANSFERIR_SZ_CHAT tool).';
