-- Fix RLS policies on pipelines and pipeline_entries tables
-- The original policies used get_user_organization_id() which returns only the FIRST org,
-- blocking master users from accessing data in orgs they switch to.
-- This migration aligns with the pattern used by pipeline_stages and legacy pipe tables.

-- === pipeline_entries ===
DROP POLICY IF EXISTS pipeline_entries_select ON pipeline_entries;
DROP POLICY IF EXISTS pipeline_entries_insert ON pipeline_entries;
DROP POLICY IF EXISTS pipeline_entries_update ON pipeline_entries;
DROP POLICY IF EXISTS pipeline_entries_delete ON pipeline_entries;
DROP POLICY IF EXISTS master_select_all_pipeline_entries ON pipeline_entries;

CREATE POLICY master_select_all_pipeline_entries ON pipeline_entries
  FOR SELECT USING (is_master_user());

CREATE POLICY pipeline_entries_select ON pipeline_entries
  FOR SELECT USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY pipeline_entries_insert ON pipeline_entries
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR is_master_user()
  );

CREATE POLICY pipeline_entries_update ON pipeline_entries
  FOR UPDATE USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR is_master_user()
  );

CREATE POLICY pipeline_entries_delete ON pipeline_entries
  FOR DELETE USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR is_master_user()
  );

-- === pipelines ===
DROP POLICY IF EXISTS pipelines_select ON pipelines;
DROP POLICY IF EXISTS pipelines_insert ON pipelines;
DROP POLICY IF EXISTS pipelines_update ON pipelines;
DROP POLICY IF EXISTS pipelines_delete ON pipelines;
DROP POLICY IF EXISTS master_all_pipelines ON pipelines;

CREATE POLICY master_all_pipelines ON pipelines
  FOR ALL USING (is_master_user());

CREATE POLICY pipelines_select ON pipelines
  FOR SELECT USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY pipelines_insert ON pipelines
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY pipelines_update ON pipelines
  FOR UPDATE USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY pipelines_delete ON pipelines
  FOR DELETE USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );
