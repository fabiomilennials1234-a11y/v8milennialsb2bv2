-- Stop the new worker and drain/reconcile work before rollback. Retain audit
-- columns and values; revocation rolls back runtime access without losing evidence.
BEGIN;
LOCK TABLE public.whatsapp_ingress_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events WHERE status <> 'completed') THEN
    RAISE EXCEPTION 'completion outcome rollback requires drained inbox' USING ERRCODE = '55000';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer) FROM service_role;
CREATE OR REPLACE FUNCTION public.claim_whatsapp_ingress_events(p_instance_ids uuid[],p_batch_size integer DEFAULT 10)
RETURNS SETOF public.whatsapp_ingress_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_instance uuid; v_event public.whatsapp_ingress_events%ROWTYPE; v_count integer := 0;
BEGIN
  IF coalesce(cardinality(p_instance_ids),0)=0 OR p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>20 THEN
    RAISE EXCEPTION 'invalid ingress claim scope' USING ERRCODE='22023';
  END IF;
  FOREACH v_instance IN ARRAY p_instance_ids LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_instance::text,29)) THEN CONTINUE; END IF;
    -- The gate closes worker admission until all prior inline effects are
    -- confirmed. No ticket has a timeout, even after worker restart.
    IF EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate
      WHERE instance_id=v_instance AND mode <> 'queued')
      OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
        WHERE instance_id=v_instance) THEN CONTINUE; END IF;
    UPDATE public.whatsapp_ingress_events SET status='dead_letter',lease_until=NULL,lease_token=NULL,
      last_error_code='lease_exhausted',updated_at=now()
      WHERE instance_id=v_instance AND status='processing' AND lease_until<now() AND attempts>=8;
    IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control
      WHERE instance_id=v_instance AND paused) THEN CONTINUE; END IF;
    SELECT * INTO v_event FROM public.whatsapp_ingress_events
      WHERE instance_id=v_instance AND status IN ('pending','processing','dead_letter')
      ORDER BY enqueue_sequence LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_event.status='dead_letter' OR v_event.attempts>=8 THEN CONTINUE; END IF;
    IF (v_event.status='pending' AND v_event.next_attempt_at>now())
      OR (v_event.status='processing' AND v_event.lease_until>=now()) THEN CONTINUE; END IF;
    RETURN QUERY UPDATE public.whatsapp_ingress_events e SET status='processing',attempts=e.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
      WHERE e.id=v_event.id RETURNING e.*;
    v_count:=v_count+1;
    EXIT WHEN v_count>=p_batch_size;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) TO service_role;
COMMIT;
