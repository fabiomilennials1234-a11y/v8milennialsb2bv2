-- Fix checklist RLS policies: replace inline JOIN team_members with
-- get_my_organization_ids() helper (SECURITY DEFINER).
-- Inline team_members in policies causes infinite recursion when
-- Realtime evaluates apply_rls() because team_members itself has RLS.

BEGIN;

-- ── checklists ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Checklists visible to org members" ON checklists;
CREATE POLICY "Checklists visible to org members" ON checklists
  FOR SELECT USING (
    organization_id IN (SELECT get_my_organization_ids())
  );

DROP POLICY IF EXISTS "Org members can insert checklists" ON checklists;
CREATE POLICY "Org members can insert checklists" ON checklists
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT get_my_organization_ids())
  );

DROP POLICY IF EXISTS "Org members can update checklists" ON checklists;
CREATE POLICY "Org members can update checklists" ON checklists
  FOR UPDATE USING (
    organization_id IN (SELECT get_my_organization_ids())
  );

DROP POLICY IF EXISTS "Org members can delete checklists" ON checklists;
CREATE POLICY "Org members can delete checklists" ON checklists
  FOR DELETE USING (
    organization_id IN (SELECT get_my_organization_ids())
  );

-- ── checklist_items ─────────────────────────────────────────

DROP POLICY IF EXISTS "Checklist items visible via parent checklist" ON checklist_items;
CREATE POLICY "Checklist items visible via parent checklist" ON checklist_items
  FOR SELECT USING (
    checklist_id IN (
      SELECT id FROM checklists
      WHERE organization_id IN (SELECT get_my_organization_ids())
    )
  );

DROP POLICY IF EXISTS "Org members can insert checklist items" ON checklist_items;
CREATE POLICY "Org members can insert checklist items" ON checklist_items
  FOR INSERT WITH CHECK (
    checklist_id IN (
      SELECT id FROM checklists
      WHERE organization_id IN (SELECT get_my_organization_ids())
    )
  );

DROP POLICY IF EXISTS "Org members can update checklist items" ON checklist_items;
CREATE POLICY "Org members can update checklist items" ON checklist_items
  FOR UPDATE USING (
    checklist_id IN (
      SELECT id FROM checklists
      WHERE organization_id IN (SELECT get_my_organization_ids())
    )
  );

DROP POLICY IF EXISTS "Org members can delete checklist items" ON checklist_items;
CREATE POLICY "Org members can delete checklist items" ON checklist_items
  FOR DELETE USING (
    checklist_id IN (
      SELECT id FROM checklists
      WHERE organization_id IN (SELECT get_my_organization_ids())
    )
  );

COMMIT;
