-- Agendamento de mensagens WhatsApp pelo usuário
-- Tabela para mensagens agendadas manualmente (não automação de pipe/campanha)

CREATE TABLE public.scheduled_user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES team_members(id),
  whatsapp_instance_id UUID REFERENCES whatsapp_instances(id),
  message_content TEXT,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'document')),
  media_filename TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_or_media CHECK (message_content IS NOT NULL OR media_url IS NOT NULL)
);

-- Worker: pegar pendentes eficientemente
CREATE INDEX idx_scheduled_user_messages_worker
  ON scheduled_user_messages (scheduled_at)
  WHERE status = 'scheduled';

-- Listar por lead (banner inline no chat)
CREATE INDEX idx_scheduled_user_messages_lead
  ON scheduled_user_messages (lead_id, status);

-- Listar por membro
CREATE INDEX idx_scheduled_user_messages_member
  ON scheduled_user_messages (created_by, status);

-- RLS
ALTER TABLE scheduled_user_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org scheduled messages"
  ON scheduled_user_messages FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can insert own org scheduled messages"
  ON scheduled_user_messages FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can update own scheduled messages"
  ON scheduled_user_messages FOR UPDATE
  USING (created_by IN (
    SELECT id FROM team_members WHERE user_id = auth.uid()
  ));

-- pg_cron: invocar Edge Function a cada 1 minuto
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_user_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_scheduled_user_messages_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-scheduled-user-messages',
      '* * * * *',
      'SELECT public.invoke_process_scheduled_user_messages()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$outer$;
