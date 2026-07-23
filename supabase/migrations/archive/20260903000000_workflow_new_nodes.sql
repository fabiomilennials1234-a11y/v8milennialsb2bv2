-- Migration: workflow_round_robin_state table + retry_of column
-- Feature: Workflow New Nodes (Esperar Janela Comercial + Definir Responsável + Retry)

-- ============================================================
-- 1. Round-robin state table for sequential distribution
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_round_robin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  last_member_index integer NOT NULL DEFAULT -1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, node_id)
);

CREATE INDEX idx_wf_rr_state_org ON workflow_round_robin_state(organization_id);

ALTER TABLE workflow_round_robin_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_round_robin_state_org_access"
  ON workflow_round_robin_state
  FOR ALL
  USING (organization_id IN (
    SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
  ));

-- ============================================================
-- 2. Retry support: add retry_of column to workflow_executions
-- ============================================================

ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS retry_of uuid REFERENCES workflow_executions(id);

CREATE INDEX idx_workflow_executions_retry_of
  ON workflow_executions(retry_of)
  WHERE retry_of IS NOT NULL;

-- ============================================================
-- 3. RPC for atomic round-robin next member
-- ============================================================

CREATE OR REPLACE FUNCTION get_next_round_robin_member(
  p_workflow_id uuid,
  p_node_id text,
  p_organization_id uuid,
  p_member_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_count integer;
  v_last_index integer;
  v_next_index integer;
  v_chosen_id uuid;
BEGIN
  v_member_count := array_length(p_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RETURN NULL;
  END IF;

  -- Advisory lock to serialize concurrent calls for same workflow+node
  PERFORM pg_advisory_xact_lock(hashtext(p_workflow_id::text || '::' || p_node_id));

  -- Get or create state
  SELECT last_member_index INTO v_last_index
  FROM workflow_round_robin_state
  WHERE workflow_id = p_workflow_id AND node_id = p_node_id;

  IF NOT FOUND THEN
    v_last_index := -1;
    INSERT INTO workflow_round_robin_state (organization_id, workflow_id, node_id, last_member_index)
    VALUES (p_organization_id, p_workflow_id, p_node_id, -1);
  END IF;

  -- Next in sequence
  v_next_index := (v_last_index + 1) % v_member_count;
  v_chosen_id := p_member_ids[v_next_index + 1]; -- PG arrays are 1-indexed

  -- Update state
  UPDATE workflow_round_robin_state
  SET last_member_index = v_next_index, updated_at = now()
  WHERE workflow_id = p_workflow_id AND node_id = p_node_id;

  RETURN v_chosen_id;
END;
$$;
