-- Agenda can receive a preselected lead/pipeline without deal_id (including
-- legacy cards that have no deal). Project onto exactly one open entry.
-- Explicit deal links keep precedence; never guess among multiple cards.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_meeting_projection_entry(
  p_org uuid, p_deal uuid, p_pipeline uuid, p_lead uuid
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(candidate.id))[1] END
  FROM (
    SELECT pe.id FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org
      AND CASE WHEN p_deal IS NOT NULL THEN
        pe.deal_id = p_deal
        AND (p_lead IS NULL OR pe.lead_id = p_lead)
        AND (p_pipeline IS NULL OR pe.pipeline_id = p_pipeline)
      ELSE
        pe.pipeline_id = p_pipeline AND pe.lead_id = p_lead
        AND pe.closed_at IS NULL
      END
    LIMIT 2
  ) candidate;
$$;
REVOKE ALL ON FUNCTION public.fn_meeting_projection_entry(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_espelho_limpa_projecao(
  p_deal_id uuid, p_org_id uuid, p_meeting_id uuid, p_meet_link text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL OR p_meeting_id IS NULL THEN RETURN; END IF;
  UPDATE public.pipeline_entries pe
  SET metadata = (CASE
      -- A manual date edit retains the stamp; it must survive cancellation.
      WHEN pe.metadata->>'meeting_date' = pe.metadata->'agenda_espelho'->>'start_at'
        THEN pe.metadata - 'meeting_date'
      ELSE pe.metadata
    END - 'agenda_espelho')
    - CASE WHEN p_meet_link IS NOT NULL AND pe.metadata->>'meet_link' = p_meet_link
        THEN ARRAY['meet_link'] ELSE ARRAY[]::text[] END
  WHERE pe.organization_id = p_org_id
    AND (p_deal_id IS NULL OR pe.deal_id = p_deal_id)
    AND pe.metadata->'agenda_espelho'->>'meeting_id' = p_meeting_id::text;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_espelho_limpa_projecao(uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_espelha_reuniao_no_funil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_entry uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_type = 'meeting' THEN
      PERFORM public.fn_espelho_limpa_projecao(NULL, OLD.organization_id, OLD.id, OLD.meet_link);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.event_type = 'meeting' AND (
    NEW.event_type IS DISTINCT FROM 'meeting'
    OR OLD.deal_id IS DISTINCT FROM NEW.deal_id
    OR OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id
    OR OLD.lead_id IS DISTINCT FROM NEW.lead_id
    OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
  ) THEN
    PERFORM public.fn_espelho_limpa_projecao(NULL, OLD.organization_id, OLD.id, OLD.meet_link);
  END IF;
  IF NEW.event_type IS DISTINCT FROM 'meeting' THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN
    PERFORM public.fn_espelho_limpa_projecao(NULL, NEW.organization_id, NEW.id, NEW.meet_link);
    RETURN NEW;
  END IF;

  v_entry := public.fn_meeting_projection_entry(
    NEW.organization_id, NEW.deal_id, NEW.pipeline_id, NEW.lead_id);
  IF v_entry IS NULL THEN RETURN NEW; END IF;

  UPDATE public.pipeline_entries pe
  SET metadata = COALESCE(pe.metadata, '{}'::jsonb)
    || jsonb_build_object('meeting_date', NEW.start_at)
    || CASE WHEN NEW.meet_link IS NOT NULL THEN jsonb_build_object('meet_link', NEW.meet_link)
         ELSE '{}'::jsonb END
    || jsonb_build_object('agenda_espelho', jsonb_build_object(
      'meeting_id', NEW.id, 'rev', gen_random_uuid()::text, 'start_at', NEW.start_at))
  WHERE pe.id = v_entry AND pe.organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_espelha_reuniao_no_funil() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_meeting_espelha_no_funil ON public.meetings;
CREATE TRIGGER trg_meeting_espelha_no_funil
AFTER INSERT OR DELETE OR UPDATE OF deal_id, pipeline_id, lead_id, organization_id,
  start_at, meet_link, status, event_type
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_espelha_reuniao_no_funil();

COMMIT;
