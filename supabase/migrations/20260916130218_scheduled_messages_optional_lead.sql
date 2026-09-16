-- A WhatsApp conversation can exist before a CRM lead is created.
-- Delivery uses phone_number and whatsapp_instance_id; keep the existing FK
-- for linked leads and all organization/author policies unchanged.
ALTER TABLE public.scheduled_user_messages ALTER COLUMN lead_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conversation_pending
ON public.scheduled_user_messages (organization_id, whatsapp_instance_id, phone_number, scheduled_at)
WHERE status = 'scheduled';
