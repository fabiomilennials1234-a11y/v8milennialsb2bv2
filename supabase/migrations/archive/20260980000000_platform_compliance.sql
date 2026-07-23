-- Wave 7 — Platform & Compliance
-- LGPD tools, Public API keys, Sandbox per org.

-- ============================================================================
-- 1. LGPD / GDPR — Consent Records
-- ============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  contact_email text,
  contact_phone text,
  consent_type text NOT NULL CHECK (consent_type IN ('marketing_email', 'marketing_whatsapp', 'marketing_sms', 'data_processing', 'data_sharing')),
  granted boolean NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'form', 'api', 'import', 'webhook')),
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_lead ON consent_records (lead_id, consent_type);
CREATE INDEX idx_consent_org ON consent_records (organization_id, consent_type);
CREATE INDEX idx_consent_email ON consent_records (contact_email) WHERE contact_email IS NOT NULL;

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see consents"
  ON consent_records FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members manage consents"
  ON consent_records FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members update consents"
  ON consent_records FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- Data retention policies per org
CREATE TABLE IF NOT EXISTS data_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  inactive_months int NOT NULL DEFAULT 24,
  auto_anonymize boolean NOT NULL DEFAULT false,
  auto_delete boolean NOT NULL DEFAULT false,
  retain_aggregated_stats boolean NOT NULL DEFAULT true,
  last_enforced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE data_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage retention"
  ON data_retention_policies FOR ALL
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

-- Data export requests (LGPD subject access)
CREATE TABLE IF NOT EXISTS data_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  contact_email text,
  export_type text NOT NULL CHECK (export_type IN ('full_export', 'erasure', 'portability')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  file_url text,
  completed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_export_org ON data_export_requests (organization_id, status);

ALTER TABLE data_export_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage exports"
  ON data_export_requests FOR ALL
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

-- RPC: Export lead data as JSON (LGPD compliance)
CREATE OR REPLACE FUNCTION export_lead_data(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() AND tm.role = 'admin' LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'lead', row_to_json(l),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name)
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lead_id = p_lead_id
    ), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(row_to_json(lh) ORDER BY lh.created_at)
      FROM lead_history lh WHERE lh.lead_id = p_lead_id
    ), '[]'::jsonb),
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversation', row_to_json(c),
        'messages', COALESCE((
          SELECT jsonb_agg(row_to_json(cm) ORDER BY cm.created_at)
          FROM conversation_messages cm WHERE cm.conversation_id = c.id
        ), '[]'::jsonb)
      ))
      FROM conversations c WHERE c.lead_id = p_lead_id
    ), '[]'::jsonb),
    'consents', COALESCE((
      SELECT jsonb_agg(row_to_json(cr))
      FROM consent_records cr WHERE cr.lead_id = p_lead_id
    ), '[]'::jsonb),
    'exported_at', now(),
    'exported_by', auth.uid()
  ) INTO v_result
  FROM leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_org_id;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 2. Public API — API Keys
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["read"]',
  rate_limit_per_minute int NOT NULL DEFAULT 100,
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (organization_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (key_prefix);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins manage API keys"
    ON api_keys FOR ALL
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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- API request logs for rate limiting + analytics
CREATE TABLE IF NOT EXISTS api_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method text NOT NULL,
  path text NOT NULL,
  status_code int NOT NULL,
  response_time_ms int,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_key_time ON api_request_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_recent ON api_request_logs (api_key_id, created_at DESC);

ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see API logs"
  ON api_request_logs FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

-- ============================================================================
-- 3. Sandbox per Org
-- ============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sandbox_source_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sandbox_created_at timestamptz;

-- RPC: Create sandbox clone
CREATE OR REPLACE FUNCTION create_org_sandbox(p_source_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_sandbox_id uuid;
  v_role text;
BEGIN
  v_user_id := auth.uid();

  SELECT tm.role INTO v_role
  FROM team_members tm
  WHERE tm.user_id = v_user_id AND tm.organization_id = p_source_org_id
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'master') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  INSERT INTO organizations (name, is_sandbox, sandbox_source_org_id, sandbox_created_at)
  SELECT
    o.name || ' [Sandbox]',
    true,
    o.id,
    now()
  FROM organizations o WHERE o.id = p_source_org_id
  RETURNING id INTO v_sandbox_id;

  INSERT INTO team_members (organization_id, user_id, role)
  VALUES (v_sandbox_id, v_user_id, 'master');

  INSERT INTO pipeline_stages (organization_id, pipeline_type, name, display_order, color)
  SELECT v_sandbox_id, ps.pipeline_type, ps.name, ps.display_order, ps.color
  FROM pipeline_stages ps
  WHERE ps.organization_id = p_source_org_id;

  INSERT INTO tags (organization_id, name, color)
  SELECT v_sandbox_id, t.name, t.color
  FROM tags t
  WHERE t.organization_id = p_source_org_id;

  RETURN v_sandbox_id;
END;
$$;
