-- Fix: pipeline_entries INSERT policy was missing is_master_user() bypass.
-- Master users in shadow mode could UPDATE/DELETE but not INSERT,
-- breaking auto-transition when moving leads to success stages.

DROP POLICY IF EXISTS "pipeline_entries_insert" ON public.pipeline_entries;

CREATE POLICY "pipeline_entries_insert" ON public.pipeline_entries
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT get_my_organization_ids())
    OR is_master_user()
  );
