-- Wave 2.3 — Call Logging
-- Manual + future VoIP call log tracking.

CREATE TABLE IF NOT EXISTS call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  contact_id uuid,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  outcome text NOT NULL CHECK (outcome IN ('connected', 'no_answer', 'busy', 'voicemail', 'wrong_number', 'callback_scheduled')),
  duration_seconds int,
  notes text,
  phone_number text,
  recording_url text,
  voip_provider text,
  voip_call_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_logs_org ON call_logs (organization_id, started_at DESC);
CREATE INDEX idx_call_logs_lead ON call_logs (lead_id, started_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_call_logs_user ON call_logs (user_id, started_at DESC);

ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org call logs"
  ON call_logs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users create call logs"
  ON call_logs FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users update own call logs"
  ON call_logs FOR UPDATE
  USING (user_id = auth.uid());

-- Auto-create lead_history entry on call log
CREATE OR REPLACE FUNCTION fn_call_log_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.lead_id,
      NEW.organization_id,
      'call_logged',
      CASE NEW.direction
        WHEN 'outbound' THEN 'Ligação realizada'
        ELSE 'Ligação recebida'
      END || ' — ' || NEW.outcome,
      'manual',
      jsonb_build_object(
        'direction', NEW.direction,
        'outcome', NEW.outcome,
        'duration_seconds', NEW.duration_seconds,
        'phone_number', NEW.phone_number
      ),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_call_log_history
  AFTER INSERT ON call_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_call_log_to_history();
