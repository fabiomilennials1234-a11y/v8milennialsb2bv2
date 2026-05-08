-- Wave 5 — Automation Evolution
-- SLA, enrollment criteria, workflow analytics, templates, re-enrollment.

-- ============================================================================
-- 1. SLA per pipeline stage
-- ============================================================================

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS sla_hours int;
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS sla_action text CHECK (sla_action IN ('notify', 'escalate', 'auto_move', 'create_followup'));
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS sla_escalate_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. Enrollment criteria + re-enrollment on workflows
-- ============================================================================

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS enrollment_criteria jsonb DEFAULT '{}';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS re_enrollment_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS re_enrollment_cooldown_days int DEFAULT 30;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS re_enrollment_max_times int DEFAULT 1;

-- ============================================================================
-- 3. workflow_templates — marketplace templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  definition jsonb NOT NULL DEFAULT '{}',
  thumbnail_url text,
  is_system boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  author_name text,
  popularity int NOT NULL DEFAULT 0,
  tags jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_templates_cat ON workflow_templates (category);
CREATE INDEX idx_workflow_templates_pop ON workflow_templates (popularity DESC);

ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone sees system templates"
  ON workflow_templates FOR SELECT
  USING (
    is_system = true
    OR organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage org templates"
  ON workflow_templates FOR ALL
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
-- 4. Workflow analytics RPC — step counts per node
-- ============================================================================

CREATE OR REPLACE FUNCTION get_workflow_node_stats(p_workflow_id uuid)
RETURNS TABLE(
  node_id text,
  executions_count bigint,
  success_count bigint,
  error_count bigint,
  avg_duration_ms numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    wes.node_id::text,
    COUNT(*) AS executions_count,
    COUNT(*) FILTER (WHERE wes.status = 'completed') AS success_count,
    COUNT(*) FILTER (WHERE wes.status = 'error') AS error_count,
    ROUND(AVG(EXTRACT(EPOCH FROM (wes.completed_at - wes.started_at)) * 1000)::numeric, 0) AS avg_duration_ms
  FROM workflow_execution_steps wes
  JOIN workflow_executions we ON we.id = wes.execution_id
  WHERE we.workflow_id = p_workflow_id
    AND we.organization_id = v_org_id
  GROUP BY wes.node_id;
END;
$$;

-- ============================================================================
-- 5. SLA breach check RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION check_sla_breaches()
RETURNS TABLE(
  pipeline_type text,
  stage_id uuid,
  stage_name text,
  sla_hours int,
  lead_id uuid,
  lead_name text,
  hours_in_stage numeric,
  responsible_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.pipeline_type,
    ps.id AS stage_id,
    ps.name AS stage_name,
    ps.sla_hours,
    l.id AS lead_id,
    l.name AS lead_name,
    ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(
      (SELECT MAX(lh.created_at)
       FROM lead_history lh
       WHERE lh.lead_id = l.id
         AND lh.action = 'stage_changed'
         AND lh.metadata->>'to_stage_id' = ps.id::text),
      l.created_at
    ))) / 3600.0, 1)::numeric AS hours_in_stage,
    l.responsible_id
  FROM pipeline_stages ps
  JOIN leads l ON l.organization_id = ps.organization_id
  WHERE ps.sla_hours IS NOT NULL
    AND ps.organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
    AND l.deleted_at IS NULL;
END;
$$;
