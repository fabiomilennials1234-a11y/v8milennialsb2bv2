-- ADR-0007: event-sourced meeting metrics.
-- Meetings stop being counted from mutable kanban state (pipe_confirmacao view)
-- and become immutable events captured at booking/held time, funnel-agnostic.
-- Attribution = snapshot of the Lead's canonical Pré-vendas at event time.

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meeting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('meeting_booked', 'meeting_held')),
  booked_event_id uuid REFERENCES public.meeting_events(id) ON DELETE SET NULL,
  -- snapshot at event time — intentionally NO FK: a deleted team member must not
  -- rewrite history, and legacy metadata can carry uuids of long-gone members
  pre_sale_responsible_id uuid,
  meeting_date timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'pipeline',
  source_entry_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_events_org_type_occurred
  ON public.meeting_events (organization_id, event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_meeting_events_org_type_meeting_date
  ON public.meeting_events (organization_id, event_type, meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_events_lead
  ON public.meeting_events (lead_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_events_presale
  ON public.meeting_events (organization_id, pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_meeting_events_booked_ref
  ON public.meeting_events (booked_event_id) WHERE booked_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_events_source_entry
  ON public.meeting_events (source_entry_id) WHERE source_entry_id IS NOT NULL;

ALTER TABLE public.meeting_events ENABLE ROW LEVEL SECURITY;

-- Reads: org members only (SECURITY DEFINER helper avoids RLS recursion — never inline team_members).
DROP POLICY IF EXISTS meeting_events_select ON public.meeting_events;
CREATE POLICY meeting_events_select ON public.meeting_events
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Writes: only via SECURITY DEFINER capture function / service_role. No anon access at all.
REVOKE ALL ON public.meeting_events FROM anon;
REVOKE ALL ON public.meeting_events FROM authenticated;
GRANT SELECT ON public.meeting_events TO authenticated;
GRANT ALL ON public.meeting_events TO service_role;

-- ── 2. Capture function + trigger ───────────────────────────────────────────
-- Booking signals: entry created in the system 'confirmacao' pipe (legacy semantics:
-- entering Agendamentos == meeting booked) OR any entry reaching stage_key 'agendado'
-- (merged Oportunidades funnel and custom pipes alike).
-- Reschedule rule (CONTEXT.md): same meeting keeps its one booked event; only a
-- meeting_date shift > 30 days creates a new booked event. A booked event that already
-- has a held event linked is closed — any new booking after it always counts as new.

CREATE OR REPLACE FUNCTION public.fn_capture_meeting_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_meeting_date timestamptz;
  v_presale uuid;
  v_prev public.meeting_events%ROWTYPE;
  v_prev_open boolean;
  v_entering_booked boolean := false;
  v_booked_id uuid;
BEGIN
  SELECT p.slug INTO v_slug FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  v_meeting_date := NULLIF(NEW.metadata->>'meeting_date', '')::timestamptz;

  SELECT COALESCE(
    NULLIF(NEW.metadata->>'pre_sale_responsible_id', '')::uuid,
    l.pre_sale_responsible_id,
    NULLIF(NEW.metadata->>'sdr_id', '')::uuid,
    l.sdr_id
  ) INTO v_presale
  FROM public.leads l WHERE l.id = NEW.lead_id;

  SELECT * INTO v_prev FROM public.meeting_events me
  WHERE me.lead_id = NEW.lead_id
    AND me.organization_id = NEW.organization_id
    AND me.event_type = 'meeting_booked'
  ORDER BY me.occurred_at DESC
  LIMIT 1;

  v_prev_open := v_prev.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events h
    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_prev.id
  );

  -- BOOKED ──────────────────────────────────────────────────────────────────
  IF (v_slug = 'confirmacao' AND TG_OP = 'INSERT')
     OR (NEW.stage_key = 'agendado' AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key)) THEN
    v_entering_booked := true;
  END IF;

  IF v_entering_booked THEN
    IF v_prev_open AND (
         v_meeting_date IS NULL OR v_prev.meeting_date IS NULL
         OR abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) <= 30 * 86400
       ) THEN
      -- reschedule of the same meeting: update date, do not count again
      UPDATE public.meeting_events
      SET meeting_date = COALESCE(v_meeting_date, meeting_date),
          metadata = metadata || jsonb_build_object('last_reschedule_at', now(), 'last_source_entry_id', NEW.id)
      WHERE id = v_prev.id;
    ELSE
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id);
    END IF;
  END IF;

  -- RESCHEDULE without stage change (meeting_date edited in place) ──────────
  IF TG_OP = 'UPDATE'
     AND NEW.stage_key = OLD.stage_key
     AND (OLD.metadata->>'meeting_date') IS DISTINCT FROM (NEW.metadata->>'meeting_date')
     AND v_meeting_date IS NOT NULL
     AND v_prev_open THEN
    IF v_prev.meeting_date IS NOT NULL
       AND abs(EXTRACT(EPOCH FROM (v_meeting_date - v_prev.meeting_date))) > 30 * 86400 THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':reschedule', NEW.id);
    ELSE
      UPDATE public.meeting_events
      SET meeting_date = v_meeting_date,
          metadata = metadata || jsonb_build_object('last_reschedule_at', now())
      WHERE id = v_prev.id;
    END IF;
  END IF;

  -- HELD ────────────────────────────────────────────────────────────────────
  IF NEW.stage_key = 'compareceu'
     AND (TG_OP = 'INSERT' OR OLD.stage_key IS DISTINCT FROM NEW.stage_key) THEN
    v_booked_id := v_prev.id;
    IF v_booked_id IS NULL THEN
      -- held without a recorded booking: create the implicit booked event first
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale, v_meeting_date, now(),
         'pipeline:' || COALESCE(v_slug, '?') || ':implicit', NEW.id)
      RETURNING id INTO v_booked_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.meeting_events h
      WHERE h.event_type = 'meeting_held' AND h.booked_event_id = v_booked_id
    ) THEN
      INSERT INTO public.meeting_events
        (organization_id, lead_id, event_type, booked_event_id, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
      VALUES
        (NEW.organization_id, NEW.lead_id, 'meeting_held', v_booked_id,
         COALESCE(v_prev.pre_sale_responsible_id, v_presale),
         COALESCE(v_meeting_date, v_prev.meeting_date), now(),
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_events_capture ON public.pipeline_entries;
CREATE TRIGGER trg_meeting_events_capture
  AFTER INSERT OR UPDATE OF stage_key, metadata ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_capture_meeting_event();

-- ── 3. Backfill ─────────────────────────────────────────────────────────────
-- Source A: every entry in the system 'confirmacao' pipe == one booked meeting.
INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
SELECT
  pe.organization_id,
  pe.lead_id,
  'meeting_booked',
  COALESCE(
    NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
    l.pre_sale_responsible_id,
    NULLIF(pe.metadata->>'sdr_id', '')::uuid,
    l.sdr_id
  ),
  NULLIF(pe.metadata->>'meeting_date', '')::timestamptz,
  COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz, pe.created_at),
  'backfill:confirmacao',
  pe.id
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.slug = 'confirmacao' AND p.type = 'system'
JOIN public.leads l ON l.id = pe.lead_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.meeting_events me
  WHERE me.source_entry_id = pe.id AND me.event_type = 'meeting_booked'
);

-- Source B: meeting stages in any other pipe (merged Oportunidades funnel, custom pipes)
-- for leads with no confirmacao entry (those were invisible to every metric).
INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
SELECT
  pe.organization_id,
  pe.lead_id,
  'meeting_booked',
  COALESCE(
    NULLIF(pe.metadata->>'pre_sale_responsible_id', '')::uuid,
    l.pre_sale_responsible_id,
    NULLIF(pe.metadata->>'sdr_id', '')::uuid,
    l.sdr_id
  ),
  NULLIF(pe.metadata->>'meeting_date', '')::timestamptz,
  COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz, pe.stage_changed_at, pe.created_at),
  'backfill:' || p.slug,
  pe.id
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id AND NOT (p.slug = 'confirmacao' AND p.type = 'system')
JOIN public.leads l ON l.id = pe.lead_id
WHERE pe.stage_key IN ('agendado', 'compareceu', 'nao_compareceu', 'remarcar')
  AND NOT EXISTS (
    SELECT 1
    FROM public.pipeline_entries pc
    JOIN public.pipelines pp ON pp.id = pc.pipeline_id AND pp.slug = 'confirmacao' AND pp.type = 'system'
    WHERE pc.lead_id = pe.lead_id AND pc.organization_id = pe.organization_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events me
    WHERE me.source_entry_id = pe.id AND me.event_type = 'meeting_booked'
  );

-- Held: one per booked event, for every lead currently sitting in 'compareceu'
-- (confirmacao status or merged/custom stage alike).
INSERT INTO public.meeting_events
  (organization_id, lead_id, event_type, booked_event_id, pre_sale_responsible_id, meeting_date, occurred_at, source, source_entry_id)
SELECT DISTINCT ON (b.id)
  pe.organization_id,
  pe.lead_id,
  'meeting_held',
  b.id,
  b.pre_sale_responsible_id,
  COALESCE(b.meeting_date, NULLIF(pe.metadata->>'meeting_date', '')::timestamptz),
  COALESCE(b.meeting_date, NULLIF(pe.metadata->>'meeting_date', '')::timestamptz, pe.stage_changed_at, pe.updated_at),
  'backfill:held',
  pe.id
FROM public.pipeline_entries pe
JOIN LATERAL (
  SELECT me.* FROM public.meeting_events me
  WHERE me.lead_id = pe.lead_id
    AND me.organization_id = pe.organization_id
    AND me.event_type = 'meeting_booked'
  ORDER BY me.occurred_at DESC
  LIMIT 1
) b ON true
WHERE pe.stage_key = 'compareceu'
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_events h
    WHERE h.event_type = 'meeting_held' AND h.booked_event_id = b.id
  );
