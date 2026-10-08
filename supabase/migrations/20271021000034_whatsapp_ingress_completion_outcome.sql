-- Terminal receipt audit plus a bounded receipt-only retry lane. A receipt
-- awaiting an older message must not hold later regular work for five minutes.
ALTER TABLE public.whatsapp_ingress_events
  ADD COLUMN completion_outcome text,
  ADD COLUMN unmatched_receipt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN receipt_deferred boolean NOT NULL DEFAULT false,
  ADD COLUMN deferral_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT whatsapp_ingress_completion_outcome_check CHECK (
    (completion_outcome IS NULL AND unmatched_receipt_count = 0)
    OR (completion_outcome = 'processed' AND unmatched_receipt_count = 0)
    OR (completion_outcome = 'unmatched_receipt' AND unmatched_receipt_count BETWEEN 1 AND 100000)
  ),
  ADD CONSTRAINT whatsapp_ingress_deferral_count_check CHECK (
    deferral_count BETWEEN 0 AND 60 AND (NOT receipt_deferred OR deferral_count > 0)
  );

CREATE INDEX whatsapp_ingress_deferred_due ON public.whatsapp_ingress_events(instance_id,next_attempt_at,enqueue_sequence)
  WHERE receipt_deferred AND status IN ('pending','processing');
CREATE INDEX whatsapp_ingress_regular_fifo ON public.whatsapp_ingress_events(instance_id,enqueue_sequence)
  WHERE NOT receipt_deferred AND status IN ('pending','processing','dead_letter');

CREATE FUNCTION public.finish_whatsapp_ingress_event_with_outcome(
  p_id uuid, p_lease_token uuid, p_error_code text DEFAULT NULL,
  p_outcome text DEFAULT 'processed', p_unmatched_count integer DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_created_at timestamptz; v_deferral_count integer; v_finished boolean;
BEGIN
  IF p_id IS NULL OR p_lease_token IS NULL OR p_outcome IS NULL
    OR p_outcome NOT IN ('processed', 'unmatched_receipt', 'deferred_receipt')
    OR p_unmatched_count IS NULL OR p_unmatched_count < 0 OR p_unmatched_count > 100000
    OR (p_outcome = 'processed' AND p_unmatched_count <> 0)
    OR (p_outcome IN ('unmatched_receipt', 'deferred_receipt')
      AND (p_unmatched_count = 0 OR p_error_code IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid ingress completion outcome' USING ERRCODE = '22023';
  END IF;
  -- Lease token fences stale workers. Audit, retry and lease release commit as
  -- one row mutation; a failed owner cannot reclassify the event.
  SELECT created_at, deferral_count INTO v_created_at, v_deferral_count
    FROM public.whatsapp_ingress_events
    WHERE id = p_id AND lease_token = p_lease_token AND status = 'processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_outcome = 'deferred_receipt' THEN
    IF v_created_at <= now() - interval '5 minutes' OR v_deferral_count >= 60 THEN
      RAISE EXCEPTION 'receipt deferral window exhausted' USING ERRCODE = '55000';
    END IF;
    UPDATE public.whatsapp_ingress_events SET
      status = 'pending', next_attempt_at = now() + interval '10 seconds',
      receipt_deferred = true, deferral_count = deferral_count + 1,
      attempts = greatest(attempts - 1, 0),
      lease_token = NULL, lease_until = NULL, last_error_code = NULL,
      completion_outcome = NULL, unmatched_receipt_count = 0,
      updated_at = now()
      WHERE id = p_id;
    RETURN true;
  END IF;
  IF p_outcome = 'unmatched_receipt' AND v_created_at > now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'unmatched receipt grace has not elapsed' USING ERRCODE = '55000';
  END IF;
  v_finished := public.finish_whatsapp_ingress_event(p_id, p_lease_token, p_error_code);
  IF NOT v_finished THEN RETURN false; END IF;
  UPDATE public.whatsapp_ingress_events SET
    completion_outcome = CASE WHEN p_error_code IS NULL THEN p_outcome ELSE NULL END,
    unmatched_receipt_count = CASE WHEN p_error_code IS NULL THEN p_unmatched_count ELSE 0 END
    WHERE id = p_id;
  RETURN true;
END $$;

-- SQL33 gate and SQL32 pause semantics remain; only claim selection gains a
-- receipt retry lane. One active lease per instance across both lanes.
CREATE OR REPLACE FUNCTION public.claim_whatsapp_ingress_events(p_instance_ids uuid[],p_batch_size integer DEFAULT 10)
RETURNS SETOF public.whatsapp_ingress_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_instance uuid;
  v_event public.whatsapp_ingress_events%ROWTYPE;
  v_regular public.whatsapp_ingress_events%ROWTYPE;
  v_deferred public.whatsapp_ingress_events%ROWTYPE;
  v_regular_ready boolean;
  v_deferred_ready boolean;
  v_regular_due timestamptz;
  v_deferred_due timestamptz;
  v_count integer := 0;
BEGIN
  IF coalesce(cardinality(p_instance_ids),0)=0 OR p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>20 THEN
    RAISE EXCEPTION 'invalid ingress claim scope' USING ERRCODE='22023';
  END IF;
  FOREACH v_instance IN ARRAY p_instance_ids LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_instance::text,29)) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate
      WHERE instance_id=v_instance AND mode <> 'queued')
      OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
        WHERE instance_id=v_instance) THEN CONTINUE; END IF;
    UPDATE public.whatsapp_ingress_events SET status='dead_letter',lease_until=NULL,lease_token=NULL,
      last_error_code='lease_exhausted',updated_at=now()
      WHERE instance_id=v_instance AND status='processing' AND lease_until<now() AND attempts>=8;
    IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control
      WHERE instance_id=v_instance AND paused) THEN CONTINUE; END IF;
    -- A still-running lease anywhere in this instance fences both lanes.
    IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
      WHERE instance_id=v_instance AND status='processing'
        AND (lease_until IS NULL OR lease_until>=now())) THEN CONTINUE; END IF;
    SELECT * INTO v_regular FROM public.whatsapp_ingress_events
      WHERE instance_id=v_instance AND NOT receipt_deferred
        AND status IN ('pending','processing','dead_letter')
      ORDER BY enqueue_sequence LIMIT 1 FOR UPDATE;
    -- A regular dead letter is a deliberate global barrier for this instance.
    IF FOUND AND v_regular.status='dead_letter' THEN CONTINUE; END IF;
    SELECT * INTO v_deferred FROM public.whatsapp_ingress_events
      WHERE instance_id=v_instance AND receipt_deferred
        AND status IN ('pending','processing')
      ORDER BY next_attempt_at,enqueue_sequence LIMIT 1 FOR UPDATE;
    v_regular_ready := v_regular.id IS NOT NULL
      AND v_regular.attempts < 8
      AND ((v_regular.status='pending' AND v_regular.next_attempt_at<=now())
        OR (v_regular.status='processing' AND v_regular.lease_until<now()));
    v_deferred_ready := v_deferred.id IS NOT NULL
      AND v_deferred.attempts < 8
      AND ((v_deferred.status='pending' AND v_deferred.next_attempt_at<=now())
        OR (v_deferred.status='processing' AND v_deferred.lease_until<now()));
    IF NOT v_regular_ready AND NOT v_deferred_ready THEN CONTINUE; END IF;
    v_regular_due := CASE WHEN v_regular.status='processing' THEN v_regular.lease_until ELSE v_regular.next_attempt_at END;
    v_deferred_due := CASE WHEN v_deferred.status='processing' THEN v_deferred.lease_until ELSE v_deferred.next_attempt_at END;
    IF v_regular_ready AND (NOT v_deferred_ready OR v_regular_due<=v_deferred_due) THEN
      v_event := v_regular;
    ELSE
      v_event := v_deferred;
    END IF;
    RETURN QUERY UPDATE public.whatsapp_ingress_events e SET status='processing',attempts=e.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
      WHERE e.id=v_event.id RETURNING e.*;
    v_count:=v_count+1;
    EXIT WHEN v_count>=p_batch_size;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) TO service_role;
