-- Fix: history_sync_jobs RLS policies missing master bypass.
-- Master users use virtual team_members in frontend but have no real
-- team_members row, so the org-based policy fails. Add is_master_user() check.

DROP POLICY IF EXISTS "Members insert own org history_sync_jobs" ON public.history_sync_jobs;
CREATE POLICY "Members insert own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR is_master_user()
  );

DROP POLICY IF EXISTS "Members update own org history_sync_jobs" ON public.history_sync_jobs;
CREATE POLICY "Members update own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR is_master_user()
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR is_master_user()
  );

DROP POLICY IF EXISTS "Members read own org history_sync_jobs" ON public.history_sync_jobs;
CREATE POLICY "Members read own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    OR is_master_user()
  );
