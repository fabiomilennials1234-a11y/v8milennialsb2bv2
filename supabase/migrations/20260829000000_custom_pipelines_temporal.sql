-- Extend custom_pipelines for temporal funnels (ex-campaigns)
-- Additive only — no breaking changes to existing data

-- 1. Add temporal columns to custom_pipelines
ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS lifecycle_type text NOT NULL DEFAULT 'permanent'
    CHECK (lifecycle_type IN ('permanent', 'temporary')),
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  ADD COLUMN IF NOT EXISTS team_goal integer,
  ADD COLUMN IF NOT EXISTS individual_goal integer,
  ADD COLUMN IF NOT EXISTS bonus_value integer,
  ADD COLUMN IF NOT EXISTS bonus_description text,
  ADD COLUMN IF NOT EXISTS objective_pipe_type text,
  ADD COLUMN IF NOT EXISTS objective_stage_key text,
  ADD COLUMN IF NOT EXISTS template_type text
    CHECK (template_type IN ('indicacao', 'prospeccao', 'reativacao')),
  ADD COLUMN IF NOT EXISTS lead_source_config jsonb;

-- 2. Create custom_pipeline_members table
CREATE TABLE IF NOT EXISTS custom_pipeline_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES custom_pipelines(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant'
    CHECK (role IN ('sdr', 'closer', 'participant')),
  goal_count integer DEFAULT 0,
  achieved_count integer DEFAULT 0,
  bonus_earned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(pipeline_id, team_member_id)
);

-- 3. RLS for custom_pipeline_members
ALTER TABLE custom_pipeline_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pipeline members in their org"
  ON custom_pipeline_members FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "Users can manage pipeline members in their org"
  ON custom_pipeline_members FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_custom_pipelines_lifecycle
  ON custom_pipelines (organization_id, lifecycle_type);

CREATE INDEX IF NOT EXISTS idx_custom_pipelines_status
  ON custom_pipelines (organization_id, status)
  WHERE lifecycle_type = 'temporary';

CREATE INDEX IF NOT EXISTS idx_custom_pipelines_ends_at
  ON custom_pipelines (ends_at)
  WHERE lifecycle_type = 'temporary' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_custom_pipeline_members_pipeline
  ON custom_pipeline_members (pipeline_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipeline_members_org
  ON custom_pipeline_members (organization_id);

CREATE INDEX IF NOT EXISTS idx_custom_pipeline_members_team_member
  ON custom_pipeline_members (team_member_id);

-- 5. All existing custom_pipelines are permanent (already default, but explicit)
-- No data migration needed — DEFAULT 'permanent' handles it
