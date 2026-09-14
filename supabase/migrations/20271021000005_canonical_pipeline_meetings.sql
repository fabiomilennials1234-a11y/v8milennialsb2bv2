-- Every dated pipeline appointment is a real meetings row. Historical metric
-- events remain the ledger; no inferred no-show and no replayed workflows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE public.meetings
  ADD COLUMN booked_event_id uuid REFERENCES public.meeting_events(id) ON DELETE SET NULL,
  ADD COLUMN pipeline_entry_id uuid REFERENCES public.pipeline_entries(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX meetings_booked_event_id_unique ON public.meetings(booked_event_id);
CREATE INDEX meetings_pipeline_entry_id_idx ON public.meetings(pipeline_entry_id);

-- Runs before the row write: identity survives rescheduling and never borrows
-- the latest appointment of another business belonging to the same lead.
CREATE OR REPLACE FUNCTION public.fn_meeting_bind_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE b public.meeting_events%ROWTYPE; v_presale uuid;
BEGIN
  IF NEW.event_type <> 'meeting' OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.organization_id=NEW.organization_id)
    OR (NEW.pipeline_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id=NEW.pipeline_id AND p.organization_id=NEW.organization_id))
    OR (NEW.deal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id=NEW.deal_id AND d.organization_id=NEW.organization_id AND d.lead_id=NEW.lead_id))
    OR (NEW.pipeline_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.id=NEW.pipeline_entry_id AND e.organization_id=NEW.organization_id AND e.lead_id=NEW.lead_id AND e.pipeline_id=NEW.pipeline_id))
  THEN RAISE EXCEPTION 'Meeting references must belong to its organization and lead' USING ERRCODE='23514'; END IF;

  IF NEW.booked_event_id IS NOT NULL THEN
    SELECT * INTO b FROM public.meeting_events WHERE id=NEW.booked_event_id FOR UPDATE;
    IF b.id IS NULL OR b.organization_id<>NEW.organization_id OR b.lead_id<>NEW.lead_id OR b.event_type<>'meeting_booked'
    THEN RAISE EXCEPTION 'Invalid meeting booking reference' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO b FROM public.meeting_events e
    WHERE e.organization_id=NEW.organization_id AND e.lead_id=NEW.lead_id
      AND e.event_type='meeting_booked'
      AND (e.metadata->>'meeting_id'=NEW.id::text
        OR NEW.external_ref='backfill:agenda-fonte-unica:meeting_event:' || e.id::text
        OR (e.meeting_date=NEW.start_at AND NEW.pipeline_entry_id IS NOT NULL AND e.source_entry_id=NEW.pipeline_entry_id))
      AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.booked_event_id=e.id AND m.id<>NEW.id)
    ORDER BY e.occurred_at DESC LIMIT 1 FOR UPDATE;
  END IF;
  IF b.id IS NULL THEN
    SELECT pre_sale_responsible_id INTO v_presale FROM public.leads WHERE id=NEW.lead_id AND organization_id=NEW.organization_id;
    INSERT INTO public.meeting_events (organization_id,lead_id,event_type,pre_sale_responsible_id,meeting_date,occurred_at,source,source_entry_id,metadata)
    VALUES (NEW.organization_id,NEW.lead_id,'meeting_booked',v_presale,NEW.start_at,COALESCE(NEW.created_at,now()),'agenda:meeting',NEW.pipeline_entry_id,jsonb_build_object('meeting_id',NEW.id))
    RETURNING * INTO b;
  END IF;
  NEW.booked_event_id := b.id;
  UPDATE public.meeting_events SET meeting_date=NEW.start_at
    WHERE id=b.id AND meeting_date IS DISTINCT FROM NEW.start_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_meeting_bind_booking() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.fn_meeting_outcome_to_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b public.meeting_events%ROWTYPE; v_outcome text;
BEGIN
  IF NEW.event_type <> 'meeting' OR NEW.lead_id IS NULL OR NEW.booked_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO b FROM public.meeting_events WHERE id=NEW.booked_event_id AND organization_id=NEW.organization_id;
  v_outcome := CASE NEW.status WHEN 'completed' THEN 'meeting_held' WHEN 'no_show' THEN 'meeting_no_show' END;
  DELETE FROM public.meeting_events WHERE organization_id=NEW.organization_id AND booked_event_id=b.id
    AND event_type IN ('meeting_held','meeting_no_show') AND (v_outcome IS NULL OR event_type<>v_outcome);
  IF v_outcome IS NOT NULL THEN
    INSERT INTO public.meeting_events (organization_id,lead_id,event_type,booked_event_id,pre_sale_responsible_id,meeting_date,occurred_at,source,metadata)
    VALUES (NEW.organization_id,NEW.lead_id,v_outcome,b.id,b.pre_sale_responsible_id,NEW.start_at,now(),'agenda:meeting',jsonb_build_object('meeting_id',NEW.id))
    ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held','meeting_no_show') DO UPDATE
      SET meeting_date=EXCLUDED.meeting_date WHERE meeting_events.meeting_date IS DISTINCT FROM EXCLUDED.meeting_date;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_meeting_outcome_to_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER trg_meeting_outcome_to_events ON public.meetings;
CREATE TRIGGER trg_meeting_bind_booking BEFORE INSERT OR UPDATE OF status,start_at,event_type,lead_id,organization_id,booked_event_id,pipeline_entry_id,pipeline_id,deal_id
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_meeting_bind_booking();
CREATE TRIGGER trg_meeting_outcome_to_events AFTER INSERT OR UPDATE OF status,start_at,booked_event_id
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_meeting_outcome_to_events();

-- Historical reconciliation does not emit notifications, outcomes or projections.
-- The table locks held by DISABLE TRIGGER exclude concurrent writers until COMMIT.
ALTER TABLE public.meetings DISABLE TRIGGER trg_meeting_bind_booking;
ALTER TABLE public.meetings DISABLE TRIGGER trg_meeting_outcome_to_events;
ALTER TABLE public.meetings DISABLE TRIGGER trg_meeting_espelha_no_funil;
WITH candidates AS (
 SELECT m.id, e.id AS booked_id,e.source_entry_id,
 row_number() OVER (PARTITION BY m.id ORDER BY (m.external_ref='backfill:agenda-fonte-unica:meeting_event:'||e.id::text) DESC NULLS LAST, e.occurred_at DESC,e.id) AS rank
 FROM public.meetings m JOIN public.meeting_events e
 ON e.organization_id=m.organization_id AND e.lead_id=m.lead_id AND e.event_type='meeting_booked'
 AND (m.external_ref='backfill:agenda-fonte-unica:meeting_event:'||e.id::text OR e.metadata->>'meeting_id'=m.id::text OR e.meeting_date=m.start_at)
 WHERE m.event_type='meeting'
), unique_links AS (
 SELECT *, count(*) OVER (PARTITION BY booked_id) AS references_count FROM candidates WHERE rank=1
)
UPDATE public.meetings m SET booked_event_id=c.booked_id,
 pipeline_entry_id=(SELECT pe.id FROM public.pipeline_entries pe WHERE pe.id=c.source_entry_id AND pe.organization_id=m.organization_id AND pe.lead_id=m.lead_id AND pe.pipeline_id=m.pipeline_id
   AND (m.deal_id IS NULL OR pe.deal_id=m.deal_id))
FROM unique_links c WHERE c.id=m.id AND c.references_count=1;

INSERT INTO public.meetings (organization_id,title,start_at,end_at,event_type,status,lead_id,pipeline_id,deal_id,pipeline_entry_id,created_by,external_ref,booked_event_id)
SELECT e.organization_id,COALESCE(NULLIF(l.name,''),'Reunião'),e.meeting_date,e.meeting_date+interval '1 hour','meeting',
 CASE WHEN h.event_type='meeting_held' THEN 'completed' WHEN h.event_type='meeting_no_show' THEN 'no_show' ELSE 'scheduled' END,
 e.lead_id,pe.pipeline_id,pe.deal_id,pe.id,tm.user_id,'canonical:meeting_event:'||e.id,e.id
FROM public.meeting_events e
JOIN public.leads l ON l.id=e.lead_id AND l.organization_id=e.organization_id
LEFT JOIN LATERAL (
 SELECT candidate.* FROM public.pipeline_entries candidate
 WHERE candidate.organization_id=e.organization_id AND candidate.lead_id=e.lead_id
   AND (candidate.id=e.source_entry_id OR candidate.id::text=e.metadata->>'last_source_entry_id')
 ORDER BY (candidate.id::text=e.metadata->>'last_source_entry_id') DESC NULLS LAST
 LIMIT 1
) pe ON true
LEFT JOIN public.team_members tm ON tm.id=e.pre_sale_responsible_id AND tm.organization_id=e.organization_id
LEFT JOIN public.meeting_events h ON h.booked_event_id=e.id AND h.organization_id=e.organization_id AND h.event_type IN ('meeting_held','meeting_no_show')
WHERE e.event_type='meeting_booked' AND e.meeting_date IS NOT NULL
 AND (e.source IS NULL OR e.source NOT LIKE 'backfill:%')
 AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.booked_event_id=e.id)
 AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.organization_id=e.organization_id AND m.lead_id=e.lead_id AND m.start_at=e.meeting_date AND m.event_type='meeting');

-- Date-only cards also become meetings, even if an old capture never wrote a booking.
INSERT INTO public.meetings (organization_id,title,start_at,end_at,event_type,status,lead_id,pipeline_id,deal_id,pipeline_entry_id,external_ref)
SELECT pe.organization_id,COALESCE(NULLIF(l.name,''),'Reunião'),(pe.metadata->>'meeting_date')::timestamptz,
 (pe.metadata->>'meeting_date')::timestamptz+interval '1 hour','meeting',
 CASE WHEN pe.stage_key='compareceu' THEN 'completed' WHEN pe.stage_key='nao_compareceu' THEN 'no_show' ELSE 'scheduled' END,
 pe.lead_id,pe.pipeline_id,pe.deal_id,pe.id,'canonical:pipeline_entry:'||pe.id
FROM public.pipeline_entries pe JOIN public.leads l ON l.id=pe.lead_id AND l.organization_id=pe.organization_id
WHERE NULLIF(pe.metadata->>'meeting_date','') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.organization_id=pe.organization_id AND m.lead_id=pe.lead_id
   AND m.event_type='meeting' AND m.start_at=(pe.metadata->>'meeting_date')::timestamptz);
INSERT INTO public.meetings (organization_id,title,description,start_at,end_at,event_type,status,lead_id,pipeline_id,deal_id,pipeline_entry_id,created_by,external_ref)
SELECT f.organization_id,f.title,f.description,f.due_date,f.due_date+interval '1 hour','meeting','scheduled',
 f.lead_id,pe.pipeline_id,pe.deal_id,pe.id,tm.user_id,'canonical:follow_up:'||f.id
FROM public.follow_ups f
JOIN public.leads l ON l.id=f.lead_id AND l.organization_id=f.organization_id
LEFT JOIN public.pipeline_entries pe ON pe.id=f.pipeline_entry_id AND pe.organization_id=f.organization_id AND pe.lead_id=f.lead_id
LEFT JOIN public.team_members tm ON tm.id=f.assigned_to AND tm.organization_id=f.organization_id
WHERE f.source_pipe='meeting' AND f.due_date IS NOT NULL AND f.archived_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.organization_id=f.organization_id AND m.lead_id=f.lead_id AND m.start_at=f.due_date AND m.event_type='meeting');
-- Attach formerly unlinked rows only when the dated business is unambiguous.
WITH candidates AS (
 SELECT m.id AS meeting_id,pe.id AS entry_id,pe.pipeline_id,pe.deal_id,
   count(*) OVER (PARTITION BY m.id) AS matches
 FROM public.meetings m JOIN public.pipeline_entries pe
 ON pe.organization_id=m.organization_id AND pe.lead_id=m.lead_id
   AND NULLIF(pe.metadata->>'meeting_date','')::timestamptz=m.start_at
   AND (m.pipeline_id IS NULL OR m.pipeline_id=pe.pipeline_id)
   AND (m.deal_id IS NULL OR m.deal_id=pe.deal_id)
 WHERE m.event_type='meeting' AND m.pipeline_entry_id IS NULL
)
UPDATE public.meetings m SET pipeline_entry_id=c.entry_id,pipeline_id=c.pipeline_id,deal_id=c.deal_id
FROM candidates c WHERE c.meeting_id=m.id AND c.matches=1;
ALTER TABLE public.meetings ENABLE TRIGGER trg_meeting_bind_booking;
ALTER TABLE public.meetings ENABLE TRIGGER trg_meeting_outcome_to_events;
ALTER TABLE public.meetings ENABLE TRIGGER trg_meeting_espelha_no_funil;

CREATE FUNCTION public.fn_pipeline_meeting_to_agenda(p_entry uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.pipeline_entries%ROWTYPE; m public.meetings%ROWTYPE; v_date timestamptz; v_name text; v_creator uuid;
BEGIN
 SELECT * INTO e FROM public.pipeline_entries WHERE id=p_entry FOR UPDATE;
 v_date := NULLIF(e.metadata->>'meeting_date','')::timestamptz;
 IF e.id IS NULL OR v_date IS NULL THEN RETURN; END IF;
 SELECT * INTO m FROM public.meetings x WHERE x.organization_id=e.organization_id AND x.lead_id=e.lead_id AND x.event_type='meeting'
 AND (x.pipeline_entry_id=e.id OR (x.id::text=e.metadata->'agenda_espelho'->>'meeting_id' AND (x.pipeline_id IS NULL OR x.pipeline_id=e.pipeline_id) AND (x.deal_id IS NULL OR x.deal_id=e.deal_id)))
 ORDER BY (x.id::text=e.metadata->'agenda_espelho'->>'meeting_id') DESC NULLS LAST,x.created_at DESC,x.id LIMIT 1;
 -- A concluded appointment at another date is history, not a reschedule target.
 IF m.id IS NOT NULL AND m.status IN ('completed','no_show','cancelled') AND m.start_at<>v_date THEN m:=NULL; END IF;
 IF m.id IS NULL THEN
   SELECT name INTO v_name FROM public.leads WHERE id=e.lead_id AND organization_id=e.organization_id;
   SELECT tm.user_id INTO v_creator FROM public.team_members tm WHERE tm.id=e.assigned_to AND tm.organization_id=e.organization_id;
   INSERT INTO public.meetings (organization_id,title,start_at,end_at,event_type,status,lead_id,pipeline_id,deal_id,pipeline_entry_id,created_by,meet_link)
   VALUES (e.organization_id,COALESCE(NULLIF(v_name,''),'Reunião'),v_date,v_date+interval '1 hour','meeting','scheduled',e.lead_id,e.pipeline_id,e.deal_id,e.id,v_creator,NULLIF(e.metadata->>'meet_link',''));
 ELSE
   UPDATE public.meetings SET start_at=v_date,end_at=v_date+(m.end_at-m.start_at),
     meet_link=COALESCE(NULLIF(e.metadata->>'meet_link',''),m.meet_link),pipeline_entry_id=e.id,pipeline_id=e.pipeline_id,deal_id=e.deal_id
   WHERE id=m.id AND organization_id=e.organization_id
     AND (start_at IS DISTINCT FROM v_date
       OR meet_link IS DISTINCT FROM COALESCE(NULLIF(e.metadata->>'meet_link',''),m.meet_link) OR pipeline_entry_id IS DISTINCT FROM e.id);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_pipeline_meeting_to_agenda(uuid) FROM PUBLIC,anon,authenticated;

-- Stage changes no longer imply booking, attendance or absence.
DROP TRIGGER IF EXISTS trg_meeting_events_capture ON public.pipeline_entries;
CREATE FUNCTION public.fn_pipeline_meeting_date_to_agenda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.metadata->'agenda_espelho'->>'rev' IS DISTINCT FROM OLD.metadata->'agenda_espelho'->>'rev'
    OR NEW.metadata->>'meeting_date' IS NOT DISTINCT FROM OLD.metadata->>'meeting_date'
  ) THEN RETURN NEW; END IF;
  IF NULLIF(NEW.metadata->>'meeting_date','') IS NOT NULL THEN
    PERFORM public.fn_pipeline_meeting_to_agenda(NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_pipeline_meeting_date_to_agenda() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_pipeline_meeting_date_to_agenda AFTER INSERT OR UPDATE OF metadata
ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.fn_pipeline_meeting_date_to_agenda();
CREATE OR REPLACE FUNCTION public.get_agenda_events(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  -- `team_members.user_id` NÃO é único: um master tem uma linha por org em que
  -- é membro. Sem o predicado de org o join FANOUT — cada meeting aparecia N
  -- vezes na agenda (medido: 16x, criador membro de 15 orgs). As demais sources
  -- juntam por `team_members.id` (PK) e não têm esse problema.
  LEFT JOIN public.team_members tm
    ON tm.user_id = m.created_by
   AND tm.organization_id = m.organization_id
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
    AND (fu.source_pipe IS DISTINCT FROM 'meeting' OR NOT EXISTS (
      SELECT 1 FROM public.meetings fm WHERE fm.organization_id=fu.organization_id
        AND fm.lead_id=fu.lead_id AND fm.start_at=fu.due_date AND fm.event_type='meeting'
    ))
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

  ORDER BY start_at ASC;
END;
$function$;

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
    OR OLD.pipeline_entry_id IS DISTINCT FROM NEW.pipeline_entry_id
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

  v_entry := NEW.pipeline_entry_id;
  IF v_entry IS NULL THEN
    v_entry := public.fn_meeting_projection_entry(
      NEW.organization_id, NEW.deal_id, NEW.pipeline_id, NEW.lead_id);
  END IF;
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
AFTER INSERT OR DELETE OR UPDATE OF deal_id, pipeline_entry_id, pipeline_id, lead_id, organization_id,
  start_at, meet_link, status, event_type
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_espelha_reuniao_no_funil();

COMMIT;
