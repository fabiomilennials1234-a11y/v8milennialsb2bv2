-- Isolated test database only; base cron fixture creates roles/default grants.
CREATE TABLE public.whatsapp_conversation_summary (
  organization_id uuid, lead_id uuid, instance_id uuid, last_message_time timestamptz, is_group boolean
);
CREATE TABLE public.conversation_summaries (
  id uuid DEFAULT gen_random_uuid(), organization_id uuid, lead_id uuid, instance_id uuid, source_last_message_at timestamptz
);
CREATE TABLE public.conversation_summary_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  lead_id uuid NOT NULL, instance_id uuid NOT NULL, last_message_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
  last_error text, updated_at timestamptz DEFAULT now(),
  CONSTRAINT conversation_summary_jobs_organization_id_lead_id_instance__key
    UNIQUE(organization_id, lead_id, instance_id)
);
