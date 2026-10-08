-- Stop the worker and drain/reconcile inbox work before disabling SQL36.
-- Preserve provider_notification outcomes and one-shot replay audit indefinitely.
BEGIN;
LOCK TABLE public.whatsapp_ingress_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events WHERE status <> 'completed') THEN
    RAISE EXCEPTION 'provider notification rollback requires drained inbox' USING ERRCODE='55000';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.requeue_whatsapp_ingress_file_download(uuid,uuid,uuid,integer,text)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.is_whatsapp_file_download_notification(jsonb)
  FROM service_role;
CREATE OR REPLACE FUNCTION public.finish_whatsapp_ingress_event_with_outcome(
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
REVOKE ALL ON FUNCTION public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_ingress_event_with_outcome(uuid,uuid,text,text,integer)
  TO service_role;
COMMIT;
