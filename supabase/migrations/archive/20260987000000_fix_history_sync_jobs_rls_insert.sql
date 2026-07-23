-- Fix: history_sync_jobs and uazapi_sender_jobs missing INSERT/UPDATE policies
-- for authenticated users. Only SELECT + service_role ALL existed — frontend
-- operations were blocked by RLS.

-- ============================================================
-- history_sync_jobs
-- ============================================================

CREATE POLICY "Members insert own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Members update own org history_sync_jobs"
  ON public.history_sync_jobs
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- uazapi_sender_jobs
-- ============================================================

CREATE POLICY "Members insert own org uazapi_sender_jobs"
  ON public.uazapi_sender_jobs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Members update own org uazapi_sender_jobs"
  ON public.uazapi_sender_jobs
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );
