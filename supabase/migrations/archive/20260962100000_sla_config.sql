-- Wave 5.1 — SLA Configuration table
-- Separate from pipeline_stages to allow fine-grained admin control.

CREATE TABLE IF NOT EXISTS sla_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_type text NOT NULL,
  stage_id uuid REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  max_hours int NOT NULL CHECK (max_hours > 0),
  escalation_action text NOT NULL DEFAULT 'notify'
    CHECK (escalation_action IN ('notify', 'escalate', 'auto_move', 'create_followup')),
  escalation_target_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sla_configs_org ON sla_configs (organization_id);
CREATE INDEX idx_sla_configs_stage ON sla_configs (stage_id) WHERE is_active = true;

ALTER TABLE sla_configs ENABLE ROW LEVEL SECURITY;

-- Org members can read SLA configs
CREATE POLICY "Users see org sla configs"
  ON sla_configs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Only admins can manage SLA configs
CREATE POLICY "Admins manage sla configs"
  ON sla_configs FOR ALL
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
