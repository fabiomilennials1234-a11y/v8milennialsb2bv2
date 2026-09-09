CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE public.whatsapp_conversation_summary (organization_id uuid, instance_id uuid, normalized_phone text, phone_number text);
CREATE TABLE public.whatsapp_messages (organization_id uuid, instance_id uuid, normalized_phone text, raw_payload jsonb);
