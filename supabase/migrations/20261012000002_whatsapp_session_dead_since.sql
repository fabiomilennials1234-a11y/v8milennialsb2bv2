-- Track when a Uazapi WhatsApp session became dead (e.g. "logged out from
-- another device"). Populated by whatsapp-session-watchdog every 10 minutes.
-- Cleared when the session returns to a healthy connected state.
--
-- Used by:
--   - UI banner on WhatsApp pages (the org sees that a number is offline)
--   - Notification subsystem (alerts owner once per transition)
--   - Health dashboard

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS session_dead_since timestamptz,
  ADD COLUMN IF NOT EXISTS session_dead_reason text;

COMMENT ON COLUMN public.whatsapp_instances.session_dead_since IS
  'Timestamp when the WhatsApp session was first observed dead by the '
  'watchdog. NULL when the session is connected. Cleared on recovery.';

COMMENT ON COLUMN public.whatsapp_instances.session_dead_reason IS
  'Last reported disconnect reason from the provider (e.g. "logged out from '
  'another device", "QR Code timeout"). NULL when connected.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_session_dead
  ON public.whatsapp_instances (organization_id)
  WHERE session_dead_since IS NOT NULL;
