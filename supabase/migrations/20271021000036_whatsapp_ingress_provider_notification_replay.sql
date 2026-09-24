-- A narrow, audited completion for an informational Uazapi FileDownloaded
-- notification. A dead letter remains a FIFO barrier until explicitly replayed.
ALTER TABLE public.whatsapp_ingress_events
  DROP CONSTRAINT whatsapp_ingress_completion_outcome_check,
  ADD CONSTRAINT whatsapp_ingress_completion_outcome_check CHECK (
    (completion_outcome IS NULL AND unmatched_receipt_count = 0)
    OR (completion_outcome IN ('processed','provider_notification') AND unmatched_receipt_count = 0)
    OR (completion_outcome = 'unmatched_receipt' AND unmatched_receipt_count BETWEEN 1 AND 100000)
  );

CREATE FUNCTION public.is_whatsapp_file_download_notification(p_payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_event jsonb; v_ids jsonb; v_key text; v_url text; v_port text;
BEGIN
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR p_payload->>'EventType' IS DISTINCT FROM 'messages_update'
    OR p_payload->>'type' IS DISTINCT FROM 'FileDownloadedMessage'
    OR p_payload->>'state' IS DISTINCT FROM 'FileDownloaded'
    OR pg_catalog.jsonb_typeof(p_payload->'event') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_payload) AS key LOOP
    IF v_key <> ALL(ARRAY['type','event','owner','state','token','BaseUrl','EventType','instanceName'])
      THEN RETURN false; END IF;
  END LOOP;
  v_event := p_payload->'event';
  v_ids := v_event->'MessageIDs';
  v_url := v_event->>'FileURL';
  IF v_event->>'Type' IS DISTINCT FROM 'FileDownloaded'
    OR v_event->'IsFromMe' IS DISTINCT FROM 'true'::jsonb
    OR pg_catalog.jsonb_typeof(v_ids) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF pg_catalog.jsonb_array_length(v_ids) <> 1
    OR pg_catalog.jsonb_typeof(v_ids->0) IS DISTINCT FROM 'string'
    OR pg_catalog.btrim(v_ids->>0) = ''
    OR pg_catalog.btrim(v_ids->>0) IS DISTINCT FROM v_ids->>0
    OR pg_catalog.jsonb_typeof(v_event->'chatid') IS DISTINCT FROM 'string'
    OR pg_catalog.btrim(v_event->>'chatid') = ''
    OR pg_catalog.btrim(v_event->>'chatid') IS DISTINCT FROM v_event->>'chatid'
    OR v_event->>'Chat' IS DISTINCT FROM v_event->>'chatid'
    OR pg_catalog.jsonb_typeof(v_event->'FileURL') IS DISTINCT FROM 'string'
    OR v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?][^#[:space:]]*)?$' THEN
    RETURN false;
  END IF;
  v_port := substring(v_url FROM '^https://[A-Za-z0-9.-]+:([0-9]{1,5})([/?]|$)');
  IF v_port IS NOT NULL AND v_port::integer > 65535 THEN RETURN false; END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(v_event) AS key LOOP
    IF v_key <> ALL(ARRAY['Chat','Type','Sender','chatid','FileURL','IsGroup','chatlid',
      'IsFromMe','MimeType','Timestamp','sender_pn','MessageIDs','sender_lid'])
      THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.is_whatsapp_file_download_notification(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_whatsapp_file_download_notification(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_whatsapp_ingress_event_with_outcome(
  p_id uuid, p_lease_token uuid, p_error_code text DEFAULT NULL,
  p_outcome text DEFAULT 'processed', p_unmatched_count integer DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_created_at timestamptz; v_deferral_count integer; v_finished boolean;
  v_event_name text; v_payload jsonb;
BEGIN
  IF p_id IS NULL OR p_lease_token IS NULL OR p_outcome IS NULL
    OR p_outcome NOT IN ('processed','unmatched_receipt','deferred_receipt','provider_notification')
    OR p_unmatched_count IS NULL OR p_unmatched_count < 0 OR p_unmatched_count > 100000
    OR (p_outcome IN ('processed','provider_notification') AND p_unmatched_count <> 0)
    OR (p_outcome IN ('unmatched_receipt','deferred_receipt')
      AND (p_unmatched_count = 0 OR p_error_code IS NOT NULL))
    OR (p_outcome = 'provider_notification' AND p_error_code IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid ingress completion outcome' USING ERRCODE = '22023';
  END IF;
  SELECT created_at,deferral_count,event_name,payload
    INTO v_created_at,v_deferral_count,v_event_name,v_payload
    FROM public.whatsapp_ingress_events
    WHERE id = p_id AND lease_token = p_lease_token AND status = 'processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_outcome = 'provider_notification' AND (
    v_event_name <> 'messages_update'
    OR NOT public.is_whatsapp_file_download_notification(v_payload)) THEN
    RAISE EXCEPTION 'provider notification payload unavailable' USING ERRCODE = '22023';
  END IF;
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

-- One replay per event. Audit persists beyond inbox retention; no payload copy.
CREATE TABLE public.whatsapp_ingress_dead_letter_replays (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  previous_attempts integer NOT NULL CHECK (previous_attempts BETWEEN 1 AND 8),
  previous_error_code text NOT NULL,
  previous_enqueue_sequence bigint NOT NULL,
  replayed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_ingress_dead_letter_replays_org ON public.whatsapp_ingress_dead_letter_replays(organization_id);
ALTER TABLE public.whatsapp_ingress_dead_letter_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_ingress_dead_letter_replays FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.whatsapp_ingress_dead_letter_replays TO service_role;

CREATE FUNCTION public.requeue_whatsapp_ingress_file_download(
  p_organization_id uuid,p_instance_id uuid,p_event_id uuid,
  p_expected_attempts integer,p_expected_error_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_event public.whatsapp_ingress_events%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR p_event_id IS NULL
    OR p_expected_attempts IS NULL OR p_expected_attempts NOT BETWEEN 1 AND 8
    OR p_expected_error_code IS NULL OR p_expected_error_code !~ '^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'invalid dead-letter replay request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text,29));
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id=p_instance_id AND organization_id=p_organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_dead_letter_replays WHERE event_id=p_event_id) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control
      WHERE instance_id=p_instance_id AND organization_id=p_organization_id AND paused)
    OR NOT EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate
      WHERE instance_id=p_instance_id AND organization_id=p_organization_id AND mode='queued')
    OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
      WHERE instance_id=p_instance_id)
    OR EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
      WHERE instance_id=p_instance_id AND status='processing') THEN
    RAISE EXCEPTION 'dead-letter replay gate unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_event FROM public.whatsapp_ingress_events
    WHERE id=p_event_id AND organization_id=p_organization_id AND instance_id=p_instance_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_event.status <> 'dead_letter' OR v_event.attempts <> p_expected_attempts
    OR v_event.last_error_code IS DISTINCT FROM p_expected_error_code THEN
    RAISE EXCEPTION 'dead-letter replay state changed' USING ERRCODE='40001';
  END IF;
  IF v_event.event_name <> 'messages_update'
    OR NOT public.is_whatsapp_file_download_notification(v_event.payload)
    OR v_event.receipt_deferred THEN
    RAISE EXCEPTION 'dead-letter replay event ineligible' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
    WHERE instance_id=p_instance_id AND status IN ('pending','processing','dead_letter')
      AND NOT receipt_deferred AND enqueue_sequence<v_event.enqueue_sequence) THEN
    RAISE EXCEPTION 'dead-letter replay is not head' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.whatsapp_ingress_dead_letter_replays
    (event_id,organization_id,instance_id,previous_attempts,previous_error_code,previous_enqueue_sequence)
    VALUES (p_event_id,p_organization_id,p_instance_id,v_event.attempts,
      v_event.last_error_code,v_event.enqueue_sequence);
  UPDATE public.whatsapp_ingress_events SET
    status='pending',attempts=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,
    last_error_code=NULL,completion_outcome=NULL,unmatched_receipt_count=0,
    updated_at=now() WHERE id=p_event_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.requeue_whatsapp_ingress_file_download(uuid,uuid,uuid,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_whatsapp_ingress_file_download(uuid,uuid,uuid,integer,text)
  TO service_role;
