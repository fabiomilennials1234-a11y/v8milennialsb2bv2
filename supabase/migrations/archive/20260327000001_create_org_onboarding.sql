-- Onboarding quiz tracking per organization
CREATE TABLE IF NOT EXISTS org_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  current_step INT NOT NULL DEFAULT 0,
  answers JSONB NOT NULL DEFAULT '{}',
  applied_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_org_onboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_onboarding_updated_at
  BEFORE UPDATE ON org_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION update_org_onboarding_updated_at();

-- RLS
ALTER TABLE org_onboarding ENABLE ROW LEVEL SECURITY;

-- Members of the org can read
CREATE POLICY "org_onboarding_select"
  ON org_onboarding FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Only admin can insert/update
CREATE POLICY "org_onboarding_insert"
  ON org_onboarding FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      JOIN user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "org_onboarding_update"
  ON org_onboarding FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      JOIN user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Indexes
CREATE INDEX idx_org_onboarding_org ON org_onboarding(organization_id);
CREATE INDEX idx_org_onboarding_status ON org_onboarding(status);

-- Auto-create onboarding row when a new org is created
CREATE OR REPLACE FUNCTION auto_create_org_onboarding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO org_onboarding (organization_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_create_org_onboarding
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_org_onboarding();
