-- ROLLBACK pareado da 20270918000010 (SCRUM-641): restaura o corpo de prod
-- pré-migration (baixado 2026-09-03) — captura volta aos predicados literais.

CREATE OR REPLACE FUNCTION public.fn_capture_meeting_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         'pipeline:' || COALESCE(v_slug, '?'), NEW.id)
      -- A linha nova: fecha a janela entre o NOT EXISTS acima e este INSERT.
      ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show') DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
