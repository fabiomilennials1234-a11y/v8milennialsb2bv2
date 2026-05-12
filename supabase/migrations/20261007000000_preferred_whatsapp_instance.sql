-- Per-user preferred WhatsApp instance.
-- Persists across devices/sessions. Both /chat and Chat Bubble read from this.

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS preferred_whatsapp_instance_id UUID
  REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.team_members.preferred_whatsapp_instance_id
  IS 'User-chosen default WhatsApp instance. Cleared automatically if instance deleted.';
