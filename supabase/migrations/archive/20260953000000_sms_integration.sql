-- Wave 2.4 — SMS Integration
-- SMS message storage and template management.

-- ============================================================================
-- 1. sms_provider_config — per-org SMS provider credentials
-- ============================================================================

CREATE TABLE IF NOT EXISTS sms_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  provider text NOT NULL CHECK (provider IN ('twilio', 'zenvia', 'vonage')),
  account_sid text,
  auth_token text,
  from_number text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_provider_config ENABLE ROW LEVEL SECURITY;

-- Credentials are admin-only
CREATE POLICY "Admins see own org SMS config"
  ON sms_provider_config FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

CREATE POLICY "Admins manage SMS config"
  ON sms_provider_config FOR ALL
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

-- ============================================================================
-- 2. sms_messages — sent/received SMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  contact_id uuid,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number text NOT NULL,
  to_number text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received')),
  provider_message_id text,
  error_message text,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_messages_org ON sms_messages (organization_id, sent_at DESC);
CREATE INDEX idx_sms_messages_lead ON sms_messages (lead_id, sent_at DESC) WHERE lead_id IS NOT NULL;

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org SMS"
  ON sms_messages FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users send SMS"
  ON sms_messages FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. sms_templates — reusable SMS templates with variables
-- ============================================================================

CREATE TABLE IF NOT EXISTS sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  body text NOT NULL,
  variables jsonb DEFAULT '[]',
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_templates_org ON sms_templates (organization_id);

ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org SMS templates"
  ON sms_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage SMS templates"
  ON sms_templates FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );
