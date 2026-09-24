-- Manual rollback of the worker pause admission gate. Keep all rows, control
-- state and snapshot evidence. Run only after draining and clearing controls.
BEGIN;
LOCK TABLE public.whatsapp_ingress_events, public.whatsapp_ingress_worker_control IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events WHERE status <> 'completed') THEN
    RAISE EXCEPTION 'ingress worker rollback requires draining all noncompleted events' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control) THEN
    RAISE EXCEPTION 'ingress worker rollback requires clearing all control rows' USING ERRCODE = '55000';
  END IF;
END $$;

-- Restore the original function body from 20271021000029 without changing its
-- signature, lease length, retry policy, or grants.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_ingress_events(p_instance_ids uuid[],p_batch_size integer DEFAULT 10)
RETURNS SETOF public.whatsapp_ingress_events LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_instance uuid; v_event public.whatsapp_ingress_events%ROWTYPE; v_count integer := 0;
BEGIN
  IF coalesce(cardinality(p_instance_ids),0)=0 OR p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>20 THEN
    RAISE EXCEPTION 'invalid ingress claim scope' USING ERRCODE='22023';
  END IF;
  -- A worker lost on its final attempt must become visible dead-letter work.
  UPDATE public.whatsapp_ingress_events SET status='dead_letter',lease_until=NULL,lease_token=NULL,
    last_error_code='lease_exhausted',updated_at=now()
    WHERE instance_id=ANY(p_instance_ids) AND status='processing' AND lease_until<now() AND attempts>=8;
  FOREACH v_instance IN ARRAY p_instance_ids LOOP
    -- Lock the instance before the subsequent statement gets its fresh
    -- snapshot. Row SKIP LOCKED alone would allow simultaneous distinct events
    -- from the same instance, reordering pin/unpin/reaction transitions.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(v_instance::text,29)) THEN CONTINUE; END IF;
    SELECT * INTO v_event FROM public.whatsapp_ingress_events
      WHERE instance_id=v_instance AND status IN ('pending','processing')
      ORDER BY enqueue_sequence LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_event.attempts>=8 THEN CONTINUE; END IF;
    IF (v_event.status='pending' AND v_event.next_attempt_at>now())
      OR (v_event.status='processing' AND v_event.lease_until>=now()) THEN CONTINUE; END IF;
    RETURN QUERY UPDATE public.whatsapp_ingress_events e SET status='processing',attempts=e.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
      WHERE e.id=v_event.id RETURNING e.*;
    v_count:=v_count+1;
    EXIT WHEN v_count>=p_batch_size;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_whatsapp_ingress_worker_pause(uuid,uuid,boolean,bigint) FROM service_role;
COMMIT;
