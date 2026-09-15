-- Preserve attendance editing after a business moves between pipelines.
CREATE OR REPLACE FUNCTION public.fn_meeting_bind_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE b public.meeting_events%ROWTYPE; v_presale uuid; v_existing_binding boolean := false;
BEGIN
  IF NEW.event_type <> 'meeting' OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  -- A movement changes the entry's current pipeline, not the meeting's history.
  -- Only an unchanged binding may retain its original pipeline. Tenant/lead
  -- validation below still runs on every write, including attendance updates.
  IF TG_OP = 'UPDATE' THEN
    v_existing_binding := ROW(NEW.organization_id,NEW.lead_id,NEW.pipeline_id,NEW.pipeline_entry_id,NEW.deal_id,NEW.booked_event_id,NEW.event_type)
      IS NOT DISTINCT FROM ROW(OLD.organization_id,OLD.lead_id,OLD.pipeline_id,OLD.pipeline_entry_id,OLD.deal_id,OLD.booked_event_id,OLD.event_type);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=NEW.lead_id AND l.organization_id=NEW.organization_id)
    OR (NEW.pipeline_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id=NEW.pipeline_id AND p.organization_id=NEW.organization_id))
    OR (NEW.deal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id=NEW.deal_id AND d.organization_id=NEW.organization_id AND d.source_lead_id=NEW.lead_id))
    OR (NEW.pipeline_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.id=NEW.pipeline_entry_id AND e.organization_id=NEW.organization_id AND e.lead_id=NEW.lead_id AND (e.pipeline_id=NEW.pipeline_id OR v_existing_binding)))
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
    SELECT COALESCE(NULLIF(e.metadata->>'pre_sale_responsible_id','')::uuid, NULLIF(e.metadata->>'sdr_id','')::uuid, l.pre_sale_responsible_id) -- metric-lint-allow: unchanged historical booking snapshot; this fix only validates pipeline references
      INTO v_presale FROM public.leads l LEFT JOIN public.pipeline_entries e
        ON e.id=NEW.pipeline_entry_id AND e.organization_id=l.organization_id AND e.lead_id=l.id
      WHERE l.id=NEW.lead_id AND l.organization_id=NEW.organization_id;
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
