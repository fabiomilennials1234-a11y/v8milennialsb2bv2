-- Manual rollback only after operators have reconciled every registered
-- instance. Refuse to restore legacy claim while any gate or ticket remains.
BEGIN;
-- Hold admission and worker tables until the guard, function replacement and
-- drops commit as one operation. No gate can be initialized after the check.
LOCK TABLE public.whatsapp_edge_execution_gate,
  public.whatsapp_edge_execution_tickets,
  public.whatsapp_ingress_events IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets)
    OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate) THEN
    RAISE EXCEPTION 'edge execution rollback requires clearing all gates and tickets'
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION public.begin_whatsapp_edge_execution(uuid,uuid,jsonb,text);
DROP FUNCTION public.complete_whatsapp_edge_execution(uuid,uuid,uuid);
DROP FUNCTION public.set_whatsapp_edge_execution_mode(uuid,uuid,text,bigint);

CREATE OR REPLACE FUNCTION public.claim_whatsapp_ingress_events(p_instance_ids uuid[],p_batch_size integer DEFAULT 10)
RETURNS SETOF public.whatsapp_ingress_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_instance uuid; v_event public.whatsapp_ingress_events%ROWTYPE; v_count integer := 0;
BEGIN
  IF coalesce(cardinality(p_instance_ids),0)=0 OR p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>20 THEN
    RAISE EXCEPTION 'invalid ingress claim scope' USING ERRCODE='22023';
  END IF;
  FOREACH v_instance IN ARRAY p_instance_ids LOOP
    -- Serialize pause and all status changes made by this claim per instance.
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_instance::text,29)) THEN CONTINUE; END IF;
    -- A worker lost on its final attempt becomes a durable FIFO barrier.
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

DROP TABLE public.whatsapp_edge_execution_tickets;
DROP TABLE public.whatsapp_edge_execution_gate;
COMMIT;
