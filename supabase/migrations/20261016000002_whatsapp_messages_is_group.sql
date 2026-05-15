-- Capture WhatsApp group messages alongside 1:1 conversations.
--
-- Previously, whatsapp-webhook dropped any event whose remote_jid ended in
-- @g.us. That kept the leads table clean (group senders are not leads) but
-- meant operators could not see group conversations the org actively used
-- for sales (Barulinho Bom, Mapila, etc.). BL-WA-05 captures these with
-- a flag that downstream code (lead creation, copilot dispatch, pipeline
-- upserts) honors to keep the existing behavior for 1:1 traffic.
--
-- Org-level opt-out: organizations.capture_groups defaults to true. Set to
-- false to restore the previous drop-on-@g.us behavior for an org.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_groups
  ON public.whatsapp_messages (organization_id, instance_id, timestamp DESC)
  WHERE is_group = true;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS capture_groups boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.whatsapp_messages.is_group IS
  'True when this message was sent in a WhatsApp group (remote_jid ends '
  'in @g.us). Lead creation, agent-message dispatch and pipeline upserts '
  'must skip rows where is_group = true.';

COMMENT ON COLUMN public.organizations.capture_groups IS
  'When false, whatsapp-webhook drops group messages on the floor (legacy '
  'pre-BL-WA-05 behavior). Default true.';
