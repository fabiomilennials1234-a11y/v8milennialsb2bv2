-- ============================================================================
-- Fix RLS on meetings + meeting_participants
-- Original policies used auth.jwt() ->> 'organization_id' but the JWT in this
-- project does NOT carry that claim, so every INSERT failed with:
--   "new row violates row-level security policy for table 'meetings'"
-- Aligning with the project-wide pattern: resolve the user's org through
-- team_members + auth.uid(), and allow master users full access.
-- ============================================================================

-- === meetings ===
DROP POLICY IF EXISTS "meetings_select_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_insert_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_update_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_delete_own_org" ON public.meetings;
DROP POLICY IF EXISTS "master_all_meetings" ON public.meetings;

CREATE POLICY "master_all_meetings" ON public.meetings
  FOR ALL USING (public.is_master_user());

CREATE POLICY "meetings_select_own_org" ON public.meetings
  FOR SELECT USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY "meetings_insert_own_org" ON public.meetings
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY "meetings_update_own_org" ON public.meetings
  FOR UPDATE USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  ) WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

CREATE POLICY "meetings_delete_own_org" ON public.meetings
  FOR DELETE USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

-- === meeting_participants ===
DROP POLICY IF EXISTS "meeting_participants_select_own_org" ON public.meeting_participants;
DROP POLICY IF EXISTS "meeting_participants_insert_own_org" ON public.meeting_participants;
DROP POLICY IF EXISTS "meeting_participants_update_own_org" ON public.meeting_participants;
DROP POLICY IF EXISTS "meeting_participants_delete_own_org" ON public.meeting_participants;
DROP POLICY IF EXISTS "master_all_meeting_participants" ON public.meeting_participants;

CREATE POLICY "master_all_meeting_participants" ON public.meeting_participants
  FOR ALL USING (public.is_master_user());

CREATE POLICY "meeting_participants_select_own_org" ON public.meeting_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id IN (
          SELECT tm.organization_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.is_active = true
        )
    )
  );

CREATE POLICY "meeting_participants_insert_own_org" ON public.meeting_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id IN (
          SELECT tm.organization_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.is_active = true
        )
    )
  );

CREATE POLICY "meeting_participants_update_own_org" ON public.meeting_participants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id IN (
          SELECT tm.organization_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.is_active = true
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id IN (
          SELECT tm.organization_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.is_active = true
        )
    )
  );

CREATE POLICY "meeting_participants_delete_own_org" ON public.meeting_participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id IN (
          SELECT tm.organization_id FROM public.team_members tm
          WHERE tm.user_id = auth.uid() AND tm.is_active = true
        )
    )
  );
