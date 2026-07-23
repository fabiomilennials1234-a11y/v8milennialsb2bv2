-- ============================================================================
-- Migration: Fix meetings.created_by FK to reference auth.users instead of team_members
-- Created: 2026-05-11
-- Problem: Frontend sends auth.users.id as created_by, but FK pointed to team_members(id).
--          Any user trying to create a meeting got:
--          "insert or update on table meetings violates foreign key constraint meetings_created_by_fkey"
-- Fix: Change FK to auth.users(id) so any authenticated user can create meetings.
--      Update get_agenda_events RPC JOIN accordingly.
-- ============================================================================

-- Step 1: Drop the incorrect FK constraint
ALTER TABLE public.meetings
  DROP CONSTRAINT IF EXISTS meetings_created_by_fkey;

-- Step 2: Add correct FK referencing auth.users(id)
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Step 3: Allow created_by to be nullable (user deletion shouldn't cascade-delete meetings)
ALTER TABLE public.meetings
  ALTER COLUMN created_by DROP NOT NULL;

-- Step 4: Fix RLS policies — original used auth.jwt()->'organization_id' which doesn't
-- exist in the JWT. Must use the same pattern as leads: subquery team_members.
DROP POLICY IF EXISTS "meetings_select_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_insert_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_update_own_org" ON public.meetings;
DROP POLICY IF EXISTS "meetings_delete_own_org" ON public.meetings;

CREATE POLICY "meetings_select_own_org"
  ON public.meetings FOR SELECT
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
  ));

CREATE POLICY "meetings_insert_own_org"
  ON public.meetings FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
  ));

CREATE POLICY "meetings_update_own_org"
  ON public.meetings FOR UPDATE
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
  ));

CREATE POLICY "meetings_delete_own_org"
  ON public.meetings FOR DELETE
  USING (organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
  ));

-- Step 5: Recreate get_agenda_events RPC with corrected JOIN for meetings source
CREATE OR REPLACE FUNCTION public.get_agenda_events(
  p_organization_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  source TEXT,
  title TEXT,
  description TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN,
  event_type TEXT,
  status TEXT,
  lead_id UUID,
  lead_name TEXT,
  lead_company TEXT,
  created_by UUID,
  creator_name TEXT,
  location TEXT,
  meet_link TEXT,
  color TEXT,
  google_event_id TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY

  -- Source 1: meetings
  SELECT
    m.id,
    'meeting'::text AS source,
    m.title,
    m.description,
    m.start_at,
    m.end_at,
    m.all_day,
    m.event_type,
    m.status,
    m.lead_id,
    l.name AS lead_name,
    l.company AS lead_company,
    m.created_by,
    tm.name AS creator_name,
    m.location,
    m.meet_link,
    m.color,
    m.google_event_id
  FROM public.meetings m
  LEFT JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.team_members tm ON tm.user_id = m.created_by
  WHERE m.organization_id = p_organization_id
    AND m.start_at < p_end
    AND m.end_at > p_start

  UNION ALL

  -- Source 2: follow_ups (non-archived, with due_date in range)
  SELECT
    fu.id,
    'follow_up'::text AS source,
    fu.title,
    fu.description,
    fu.due_date AS start_at,
    fu.due_date + interval '30 minutes' AS end_at,
    false AS all_day,
    'follow_up'::text AS event_type,
    CASE
      WHEN fu.completed_at IS NOT NULL THEN 'completed'
      ELSE 'scheduled'
    END AS status,
    fu.lead_id,
    l2.name AS lead_name,
    l2.company AS lead_company,
    fu.assigned_to AS created_by,
    tm2.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.follow_ups fu
  LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
  LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
  WHERE fu.organization_id = p_organization_id
    AND fu.archived_at IS NULL
    AND fu.due_date >= p_start
    AND fu.due_date < p_end

  UNION ALL

  -- Source 3: scheduled_user_messages (only scheduled/sending)
  SELECT
    sm.id,
    'scheduled_message'::text AS source,
    COALESCE(
      LEFT(sm.message_content, 60),
      'Mensagem agendada'
    ) AS title,
    sm.message_content AS description,
    sm.scheduled_at AS start_at,
    sm.scheduled_at + interval '5 minutes' AS end_at,
    false AS all_day,
    'task'::text AS event_type,
    sm.status,
    sm.lead_id,
    l3.name AS lead_name,
    l3.company AS lead_company,
    sm.created_by,
    tm3.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.scheduled_user_messages sm
  LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
  LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
  WHERE sm.organization_id = p_organization_id
    AND sm.status IN ('scheduled', 'sending')
    AND sm.scheduled_at >= p_start
    AND sm.scheduled_at < p_end

  UNION ALL

  -- Source 4: pipe_confirmacao (entries with non-null meeting_date)
  SELECT
    pc.id,
    'pipe_confirmacao'::text AS source,
    COALESCE(l4.name, 'Reuniao') AS title,
    pc.notes AS description,
    pc.meeting_date AS start_at,
    pc.meeting_date + interval '1 hour' AS end_at,
    false AS all_day,
    'meeting'::text AS event_type,
    pc.status::text AS status,
    pc.lead_id,
    l4.name AS lead_name,
    l4.company AS lead_company,
    COALESCE(pc.closer_id, pc.sdr_id) AS created_by,
    COALESCE(tm_closer.name, tm_sdr.name) AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.pipe_confirmacao pc
  LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = pc.closer_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pc.sdr_id
  WHERE pc.organization_id = p_organization_id
    AND pc.meeting_date IS NOT NULL
    AND pc.meeting_date >= p_start
    AND pc.meeting_date < p_end

  ORDER BY start_at ASC;
END;
$$;
