-- Wave 2.1 — Email Sync
-- Stores connected email accounts and synced email messages.

-- ============================================================================
-- 1. email_accounts — OAuth-connected email accounts
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  email_address text NOT NULL,
  display_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_cursor text,
  last_sync_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'synced', 'error')),
  sync_error text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email_address)
);

CREATE INDEX idx_email_accounts_org ON email_accounts (organization_id);
CREATE INDEX idx_email_accounts_user ON email_accounts (user_id);

ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

-- Tokens are sensitive — users only see their own accounts
CREATE POLICY "Users see own email accounts"
  ON email_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users manage own email accounts"
  ON email_accounts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 2. emails — synced email messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  thread_id text,
  in_reply_to text,
  from_address text NOT NULL,
  from_name text,
  to_addresses jsonb NOT NULL DEFAULT '[]',
  cc_addresses jsonb DEFAULT '[]',
  bcc_addresses jsonb DEFAULT '[]',
  subject text,
  body_html text,
  body_text text,
  snippet text,
  sent_at timestamptz NOT NULL,
  received_at timestamptz,
  read_at timestamptz,
  is_outbound boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  labels jsonb DEFAULT '[]',
  -- Linkage to CRM entities
  contact_id uuid,
  deal_id uuid,
  lead_id uuid,
  -- Tracking
  open_count int NOT NULL DEFAULT 0,
  first_opened_at timestamptz,
  click_count int NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  --
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_emails_org ON emails (organization_id, sent_at DESC);
CREATE INDEX idx_emails_account ON emails (email_account_id, sent_at DESC);
CREATE INDEX idx_emails_thread ON emails (thread_id);
CREATE INDEX idx_emails_contact ON emails (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_emails_lead ON emails (lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX idx_emails_message ON emails (email_account_id, message_id);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org emails"
  ON emails FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert via account"
  ON emails FOR INSERT
  WITH CHECK (
    email_account_id IN (
      SELECT id FROM email_accounts WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. email_templates — reusable email templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  variables jsonb DEFAULT '[]',
  category text,
  is_shared boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_templates_org ON email_templates (organization_id);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org templates"
  ON email_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage own templates"
  ON email_templates FOR ALL
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

-- ============================================================================
-- 4. RPCs
-- ============================================================================

-- Get email thread
CREATE OR REPLACE FUNCTION get_email_thread(p_thread_id text)
RETURNS TABLE(
  id uuid,
  message_id text,
  from_address text,
  from_name text,
  to_addresses jsonb,
  cc_addresses jsonb,
  subject text,
  body_html text,
  body_text text,
  snippet text,
  sent_at timestamptz,
  is_outbound boolean,
  has_attachments boolean,
  read_at timestamptz,
  open_count int,
  click_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.message_id, e.from_address, e.from_name,
    e.to_addresses, e.cc_addresses, e.subject,
    e.body_html, e.body_text, e.snippet,
    e.sent_at, e.is_outbound, e.has_attachments,
    e.read_at, e.open_count, e.click_count
  FROM emails e
  WHERE e.thread_id = p_thread_id
    AND e.organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  ORDER BY e.sent_at ASC;
END;
$$;
