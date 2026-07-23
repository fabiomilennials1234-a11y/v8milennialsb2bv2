-- ============================================================================
-- Migration: Create meetings + meeting_participants tables (Agenda Phase 1)
-- Created: 2026-05-04
-- Description: Internal calendar system for Torque CRM. Multi-tenant with RLS.
--              Includes RPC get_agenda_events that UNIONs meetings, follow_ups,
--              scheduled_user_messages, and pipe_confirmacao into a unified feed.
-- ============================================================================

-- ============================================================================
-- Table: meetings
-- Purpose: Internal calendar events (meetings, calls, follow-ups, tasks)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  event_type TEXT NOT NULL DEFAULT 'meeting'
    CHECK (event_type IN ('meeting', 'call', 'follow_up', 'task', 'other')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.team_members(id),
  google_event_id TEXT,
  meet_link TEXT,
  color TEXT,
  recurrence_rule TEXT,
  external_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Indexes: meetings
-- ============================================================================

-- Primary query path: calendar view filtered by org + time range
CREATE INDEX IF NOT EXISTS idx_meetings_org_start
  ON public.meetings (organization_id, start_at);

-- Lead-scoped queries (show meetings for a specific lead)
CREATE INDEX IF NOT EXISTS idx_meetings_org_lead
  ON public.meetings (organization_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- User-scoped queries (my meetings as creator)
CREATE INDEX IF NOT EXISTS idx_meetings_org_created_by
  ON public.meetings (organization_id, created_by);

-- Google Calendar sync lookups (upsert by google_event_id)
CREATE INDEX IF NOT EXISTS idx_meetings_google_event_id
  ON public.meetings (google_event_id)
  WHERE google_event_id IS NOT NULL;

-- API idempotency via external_ref (unique per org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_org_external_ref
  ON public.meetings (organization_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- ============================================================================
-- RLS: meetings
-- ============================================================================

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meetings_select_own_org"
  ON public.meetings FOR SELECT
  USING (organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid));

CREATE POLICY "meetings_insert_own_org"
  ON public.meetings FOR INSERT
  WITH CHECK (organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid));

CREATE POLICY "meetings_update_own_org"
  ON public.meetings FOR UPDATE
  USING (organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid))
  WITH CHECK (organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid));

CREATE POLICY "meetings_delete_own_org"
  ON public.meetings FOR DELETE
  USING (organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid));

-- ============================================================================
-- Trigger: updated_at on meetings
-- ============================================================================

-- Reuse existing function (created in google_calendar migration)
DROP TRIGGER IF EXISTS update_meetings_updated_at ON public.meetings;
CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Table: meeting_participants
-- Purpose: N:M between meetings and team_members, with RSVP status
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('accepted', 'declined', 'tentative', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meeting_participant UNIQUE (meeting_id, team_member_id)
);

-- Index for "my meetings" queries (find all meetings where I'm a participant)
CREATE INDEX IF NOT EXISTS idx_meeting_participants_member
  ON public.meeting_participants (team_member_id, meeting_id);

-- ============================================================================
-- RLS: meeting_participants
-- ============================================================================

ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

-- SELECT: user can see participants of meetings in their org
CREATE POLICY "meeting_participants_select_own_org"
  ON public.meeting_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid)
    )
  );

-- INSERT: user can add participants to meetings in their org
CREATE POLICY "meeting_participants_insert_own_org"
  ON public.meeting_participants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid)
    )
  );

-- UPDATE: user can update participant status in meetings in their org
CREATE POLICY "meeting_participants_update_own_org"
  ON public.meeting_participants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid)
    )
  );

-- DELETE: user can remove participants from meetings in their org
CREATE POLICY "meeting_participants_delete_own_org"
  ON public.meeting_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id
        AND m.organization_id = (SELECT (auth.jwt() ->> 'organization_id')::uuid)
    )
  );

-- ============================================================================
-- RPC: get_agenda_events
-- Purpose: Unified calendar feed from 4 sources:
--   1. meetings (full event data)
--   2. follow_ups (due_date as start_at, +30min as end_at)
--   3. scheduled_user_messages (scheduled_at as start_at, +5min as end_at)
--   4. pipe_confirmacao (meeting_date as start_at, +1h as end_at)
-- ============================================================================

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
  LEFT JOIN public.team_members tm ON tm.id = m.created_by
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

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.meetings IS
  'Internal calendar events for the organization agenda (meetings, calls, tasks)';

COMMENT ON TABLE public.meeting_participants IS
  'N:M relationship between meetings and team members with RSVP status';

COMMENT ON FUNCTION public.get_agenda_events IS
  'Returns a unified calendar feed from meetings, follow_ups, scheduled_user_messages, and pipe_confirmacao';
