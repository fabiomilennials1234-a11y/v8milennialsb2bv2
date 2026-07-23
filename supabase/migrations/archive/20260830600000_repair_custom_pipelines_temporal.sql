-- REPAIR: Apply temporal columns to custom_pipelines
-- The original migration 20260829000000 was registered but never executed.
-- This repair migration uses IF NOT EXISTS to be idempotent.

-- Add columns one by one to avoid partial failure
ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS lifecycle_type text NOT NULL DEFAULT 'permanent';

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS team_goal integer;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS individual_goal integer;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS bonus_value integer;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS bonus_description text;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS objective_pipe_type text;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS objective_stage_key text;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS template_type text;

ALTER TABLE custom_pipelines
  ADD COLUMN IF NOT EXISTS lead_source_config jsonb;

-- Add CHECK constraints only if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_pipelines_lifecycle_type_check'
  ) THEN
    ALTER TABLE custom_pipelines
      ADD CONSTRAINT custom_pipelines_lifecycle_type_check
      CHECK (lifecycle_type IN ('permanent', 'temporary'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_pipelines_status_check'
  ) THEN
    ALTER TABLE custom_pipelines
      ADD CONSTRAINT custom_pipelines_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'ended'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_pipelines_template_type_check'
  ) THEN
    ALTER TABLE custom_pipelines
      ADD CONSTRAINT custom_pipelines_template_type_check
      CHECK (template_type IN ('indicacao', 'prospeccao', 'reativacao'));
  END IF;
END $$;

-- Create custom_pipeline_members table if not exists
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

-- RLS for custom_pipeline_members (idempotent)
ALTER TABLE custom_pipeline_members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can view pipeline members in their org' AND tablename = 'custom_pipeline_members'
  ) THEN
    CREATE POLICY "Users can view pipeline members in their org"
      ON custom_pipeline_members FOR SELECT
      USING (organization_id = public.get_user_organization_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage pipeline members in their org' AND tablename = 'custom_pipeline_members'
  ) THEN
    CREATE POLICY "Users can manage pipeline members in their org"
      ON custom_pipeline_members FOR ALL
      USING (organization_id = public.get_user_organization_id())
      WITH CHECK (organization_id = public.get_user_organization_id());
  END IF;
END $$;

-- Indexes (idempotent)
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
