-- Bounded, service-only receipt reconciliation for one queued WhatsApp instance.
-- The cursor is a fixed seven-day window. No historical backfill or direct
-- whatsapp_messages writes occur here. Existing instance/direction indexes
-- support the pilot; a new index on the large message table is deferred until
-- a production EXPLAIN establishes its cost and benefit.
-- Trusted provenance is assigned only by the recovery admission RPC. Provider
-- payload JSON cannot set this column through the ordinary enqueue function.
ALTER TABLE public.whatsapp_ingress_events
  ADD COLUMN receipt_recovery boolean NOT NULL DEFAULT false;

CREATE TABLE public.whatsapp_receipt_recovery_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  window_start timestamptz,
  window_end timestamptz,
  last_created_at timestamptz,
  last_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  lease_started_at timestamptz,
  proposed_created_at timestamptz,
  proposed_id uuid,
  proposed_has_more boolean,
  pending_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  enqueued_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_result jsonb,
  last_finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, instance_id),
  UNIQUE (instance_id),
  CHECK ((window_start IS NULL AND window_end IS NULL) OR
         (window_start IS NOT NULL AND window_end IS NOT NULL AND window_start < window_end)),
  CHECK ((last_created_at IS NULL) = (last_id IS NULL)),
  CHECK ((proposed_created_at IS NULL) = (proposed_id IS NULL)),
  CHECK ((lease_token IS NULL AND lease_until IS NULL AND lease_started_at IS NULL) OR
         (lease_token IS NOT NULL AND lease_until IS NOT NULL AND lease_started_at IS NOT NULL)),
  CHECK (jsonb_typeof(pending_candidate_ids) = 'array' AND jsonb_array_length(pending_candidate_ids) <= 50),
  CHECK (jsonb_typeof(enqueued_candidate_ids) = 'array' AND jsonb_array_length(enqueued_candidate_ids) <= 50)
);
ALTER TABLE public.whatsapp_receipt_recovery_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_receipt_recovery_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.whatsapp_receipt_recovery_state TO service_role;

-- An inconclusive provider lookup remains visible after the cursor advances or
-- its seven-day window rolls over. This is coverage evidence, not a repair queue.
CREATE TABLE public.whatsapp_receipt_recovery_gaps (
  organization_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  message_row_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, message_row_id),
  FOREIGN KEY (organization_id, instance_id)
    REFERENCES public.whatsapp_receipt_recovery_state(organization_id, instance_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_receipt_recovery_gaps_org ON public.whatsapp_receipt_recovery_gaps(organization_id);
ALTER TABLE public.whatsapp_receipt_recovery_gaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_receipt_recovery_gaps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.whatsapp_receipt_recovery_gaps TO service_role;

CREATE FUNCTION public.begin_whatsapp_receipt_recovery(p_organization_id uuid, p_instance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state public.whatsapp_receipt_recovery_state%ROWTYPE;
  v_rows jsonb; v_count integer; v_last_created_at timestamptz; v_last_id uuid;
  v_has_more boolean; v_token uuid := gen_random_uuid();
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'invalid recovery scope' USING ERRCODE = '22023';
  END IF;
  -- Distinct from the ingress admission lock. Recovery observes the gate and
  -- inbox under lock 29, then reserves its own lease under lock 35.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 35));
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate
    WHERE instance_id = p_instance_id AND organization_id = p_organization_id AND mode = 'queued')
    OR EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control
      WHERE instance_id = p_instance_id AND paused)
    OR EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
      WHERE instance_id = p_instance_id AND status <> 'completed')
    OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
      WHERE instance_id = p_instance_id)
    OR EXISTS (SELECT 1 FROM public.copilot_quotes
      WHERE organization_id = p_organization_id AND status = 'awaiting_confirmation')
    THEN RETURN NULL; END IF;
  INSERT INTO public.whatsapp_receipt_recovery_state (organization_id, instance_id)
    VALUES (p_organization_id, p_instance_id) ON CONFLICT (instance_id) DO NOTHING;
  SELECT * INTO v_state FROM public.whatsapp_receipt_recovery_state
    WHERE instance_id = p_instance_id FOR UPDATE;
  IF v_state.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'recovery state organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_state.lease_until > now() THEN RETURN NULL; END IF;
  IF v_state.window_start IS NULL THEN
    v_state.window_start := now() - interval '7 days';
    v_state.window_end := now();
    v_state.last_created_at := NULL;
    v_state.last_id := NULL;
  END IF;
  -- A 51st row only establishes has_more; never leaves the database.
  WITH batch AS (
    SELECT m.id, m.message_id, m.remote_jid, m.status, m.created_at
    FROM public.whatsapp_messages m
    WHERE m.organization_id = p_organization_id AND m.instance_id = p_instance_id
      AND m.direction = 'outgoing' AND m.status IN ('pending','sent','delivered','failed')
      AND m.deleted_at IS NULL AND m.created_at >= v_state.window_start
      AND m.created_at < v_state.window_end
      AND (v_state.last_created_at IS NULL OR (m.created_at,m.id) > (v_state.last_created_at,v_state.last_id))
    ORDER BY m.created_at,m.id LIMIT 51
  ), numbered AS (
    SELECT batch.*, row_number() OVER (ORDER BY created_at,id) AS rn FROM batch
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'message_id',message_id,
      'remote_jid',remote_jid,'status',status,'created_at',created_at)
      ORDER BY created_at,id) FILTER (WHERE rn <= 50), '[]'::jsonb),
    count(*)::integer,
    max(created_at) FILTER (WHERE rn = 50),
    (array_agg(id ORDER BY rn DESC) FILTER (WHERE rn <= 50))[1]
  INTO v_rows,v_count,v_last_created_at,v_last_id FROM numbered;
  v_has_more := v_count > 50;
  -- For a short page the final row, not row 50, is its proposed cursor.
  IF v_count > 0 AND v_count < 50 THEN
    SELECT (item->>'created_at')::timestamptz,(item->>'id')::uuid
      INTO v_last_created_at,v_last_id
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS e(item,ord)
      ORDER BY ord DESC LIMIT 1;
  END IF;
  UPDATE public.whatsapp_receipt_recovery_state SET
    window_start = v_state.window_start, window_end = v_state.window_end,
    lease_token = v_token, lease_started_at = now(), lease_until = now() + interval '2 minutes',
    proposed_created_at = v_last_created_at, proposed_id = v_last_id,
    proposed_has_more = v_has_more,
    pending_candidate_ids = (SELECT coalesce(jsonb_agg(item->'id'), '[]'::jsonb)
      FROM jsonb_array_elements(v_rows) AS e(item)),
    enqueued_candidate_ids = '[]'::jsonb, revision = revision + 1,
    updated_at = now()
    WHERE instance_id = p_instance_id;
  RETURN jsonb_build_object('lease_token',v_token,'window_start',v_state.window_start,
    'window_end',v_state.window_end,'candidates',v_rows,'has_more',v_has_more,
    'next_created_at',v_last_created_at,'next_id',v_last_id);
END $$;

CREATE FUNCTION public.enqueue_whatsapp_receipt_recovery(
  p_organization_id uuid, p_instance_id uuid, p_lease_token uuid,
  p_message_row_id uuid, p_status text, p_observed_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state public.whatsapp_receipt_recovery_state%ROWTYPE;
  v_message public.whatsapp_messages%ROWTYPE; v_provider_instance text; v_event_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR p_lease_token IS NULL
    OR p_message_row_id IS NULL OR p_status IS NULL OR p_status NOT IN ('delivered','read')
    OR p_observed_at IS NULL THEN
    RAISE EXCEPTION 'invalid recovery enqueue' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 35));
  SELECT * INTO v_state FROM public.whatsapp_receipt_recovery_state
    WHERE organization_id = p_organization_id AND instance_id = p_instance_id FOR UPDATE;
  IF NOT FOUND OR v_state.lease_token IS DISTINCT FROM p_lease_token
    OR v_state.lease_until <= now() THEN
    RAISE EXCEPTION 'recovery lease unavailable' USING ERRCODE = '55000';
  END IF;
  IF p_observed_at < v_state.lease_started_at OR p_observed_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'recovery observation outside lease' USING ERRCODE = '22023';
  END IF;
  IF NOT v_state.pending_candidate_ids @> jsonb_build_array(p_message_row_id) THEN
    RAISE EXCEPTION 'recovery candidate unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_state.enqueued_candidate_ids @> jsonb_build_array(p_message_row_id) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances
      WHERE id = p_instance_id AND organization_id = p_organization_id)
    OR NOT EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_gate
      WHERE instance_id = p_instance_id AND organization_id = p_organization_id AND mode = 'queued')
    OR EXISTS (SELECT 1 FROM public.whatsapp_ingress_worker_control
      WHERE instance_id = p_instance_id AND paused)
    OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
      WHERE instance_id = p_instance_id)
    OR EXISTS (SELECT 1 FROM public.copilot_quotes
      WHERE organization_id = p_organization_id AND status = 'awaiting_confirmation') THEN
    RAISE EXCEPTION 'recovery gate unavailable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_message FROM public.whatsapp_messages
    WHERE id = p_message_row_id AND organization_id = p_organization_id AND instance_id = p_instance_id
      AND direction = 'outgoing' AND deleted_at IS NULL
      AND created_at >= v_state.window_start AND created_at < v_state.window_end
      AND ((p_status = 'delivered' AND status IN ('pending','sent','failed'))
        OR (p_status = 'read' AND status IN ('pending','sent','delivered','failed')))
    FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT uazapi_instance_id INTO v_provider_instance FROM public.whatsapp_instance_secrets
    WHERE instance_id = p_instance_id AND organization_id = p_organization_id;
  IF v_provider_instance IS NULL OR v_provider_instance = '' THEN
    RAISE EXCEPTION 'provider instance unavailable' USING ERRCODE = '55000';
  END IF;
  -- Only the canonical queued worker can apply the receipt. Payload identity
  -- and target come from tenant-scoped database rows, never from caller JSON.
  v_event_id := public.enqueue_whatsapp_ingress_event(p_organization_id,p_instance_id,
    'messages_update',jsonb_build_object('instance',v_provider_instance,
      'event','messages_update','data',jsonb_build_object('id',v_message.message_id,
      'status',p_status,'fromMe',false,'chatid',v_message.remote_jid),
      'receipt_recovery',jsonb_build_object('observed_at',p_observed_at)));
  UPDATE public.whatsapp_ingress_events SET receipt_recovery = true
    WHERE id = v_event_id AND organization_id = p_organization_id
      AND instance_id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery event unavailable' USING ERRCODE = '55000';
  END IF;
  UPDATE public.whatsapp_receipt_recovery_state SET
    enqueued_candidate_ids = enqueued_candidate_ids || jsonb_build_array(p_message_row_id)
    WHERE organization_id = p_organization_id AND instance_id = p_instance_id;
  RETURN v_event_id;
END $$;

CREATE FUNCTION public.finish_whatsapp_receipt_recovery(
  p_organization_id uuid, p_instance_id uuid, p_lease_token uuid, p_results jsonb,
  p_inconclusive_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state public.whatsapp_receipt_recovery_state%ROWTYPE;
  v_key text; v_number numeric;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR p_lease_token IS NULL
    OR jsonb_typeof(p_results) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_results)) <> 6
    OR p_inconclusive_ids IS NULL THEN
    RAISE EXCEPTION 'invalid recovery result' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['checked','planned','enqueued','inconclusive','unscanned','error'] LOOP
    IF NOT p_results ? v_key OR jsonb_typeof(p_results->v_key) <> 'number'
      OR (p_results->>v_key) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid recovery result' USING ERRCODE = '22023';
    END IF;
    v_number := (p_results->>v_key)::numeric;
    IF v_number > 50 THEN RAISE EXCEPTION 'invalid recovery result' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF (p_results->>'planned')::integer > (p_results->>'checked')::integer
    OR (p_results->>'enqueued')::integer > (p_results->>'planned')::integer
    OR (p_results->>'inconclusive')::integer > (p_results->>'checked')::integer
    OR (p_results->>'checked')::integer + (p_results->>'unscanned')::integer > 50 THEN
    RAISE EXCEPTION 'invalid recovery result' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_inconclusive_ids) <> (p_results->>'inconclusive')::integer
    OR array_position(p_inconclusive_ids, NULL) IS NOT NULL
    OR (SELECT count(DISTINCT id) FROM unnest(p_inconclusive_ids) AS id)
      <> cardinality(p_inconclusive_ids) THEN
    RAISE EXCEPTION 'invalid recovery gap identifiers' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 35));
  SELECT * INTO v_state FROM public.whatsapp_receipt_recovery_state
    WHERE organization_id = p_organization_id AND instance_id = p_instance_id FOR UPDATE;
  IF NOT FOUND OR v_state.lease_token IS DISTINCT FROM p_lease_token
    OR v_state.lease_until <= now() THEN RETURN false; END IF;
  IF (p_results->>'checked')::integer + (p_results->>'unscanned')::integer
      <> jsonb_array_length(v_state.pending_candidate_ids) THEN
    RAISE EXCEPTION 'recovery result count mismatch' USING ERRCODE = '22023';
  END IF;
  IF (p_results->>'enqueued')::integer <> jsonb_array_length(v_state.enqueued_candidate_ids) THEN
    RAISE EXCEPTION 'recovery enqueue count mismatch' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_inconclusive_ids) AS id
    WHERE NOT v_state.pending_candidate_ids @> jsonb_build_array(id)) THEN
    RAISE EXCEPTION 'recovery gap outside batch' USING ERRCODE = '22023';
  END IF;
  IF (p_results->>'unscanned')::integer = 0 AND (p_results->>'error')::integer = 0 THEN
    DELETE FROM public.whatsapp_receipt_recovery_gaps g
      WHERE g.instance_id = p_instance_id AND g.organization_id = p_organization_id
        AND v_state.pending_candidate_ids @> jsonb_build_array(g.message_row_id)
        AND NOT (g.message_row_id = ANY(p_inconclusive_ids));
    INSERT INTO public.whatsapp_receipt_recovery_gaps
      (organization_id,instance_id,message_row_id)
      SELECT p_organization_id,p_instance_id,id FROM unnest(p_inconclusive_ids) AS id
      ON CONFLICT (instance_id,message_row_id) DO UPDATE
        SET last_seen_at = now();
    IF (SELECT count(*) FROM public.whatsapp_receipt_recovery_gaps
      WHERE instance_id = p_instance_id) > 1000 THEN
      RAISE EXCEPTION 'recovery gap capacity exhausted' USING ERRCODE = '54000';
    END IF;
  END IF;
  UPDATE public.whatsapp_receipt_recovery_state SET
    last_created_at = CASE WHEN (p_results->>'unscanned')::integer = 0
      AND (p_results->>'error')::integer = 0 AND v_state.proposed_has_more
      THEN v_state.proposed_created_at ELSE CASE WHEN (p_results->>'unscanned')::integer = 0
        AND (p_results->>'error')::integer = 0 THEN NULL ELSE v_state.last_created_at END END,
    last_id = CASE WHEN (p_results->>'unscanned')::integer = 0
      AND (p_results->>'error')::integer = 0 AND v_state.proposed_has_more
      THEN v_state.proposed_id ELSE CASE WHEN (p_results->>'unscanned')::integer = 0
        AND (p_results->>'error')::integer = 0 THEN NULL ELSE v_state.last_id END END,
    window_start = CASE WHEN (p_results->>'unscanned')::integer = 0
      AND (p_results->>'error')::integer = 0 AND NOT v_state.proposed_has_more
      THEN NULL ELSE v_state.window_start END,
    window_end = CASE WHEN (p_results->>'unscanned')::integer = 0
      AND (p_results->>'error')::integer = 0 AND NOT v_state.proposed_has_more
      THEN NULL ELSE v_state.window_end END,
    lease_token = NULL, lease_until = NULL, lease_started_at = NULL,
    proposed_created_at = NULL, proposed_id = NULL, proposed_has_more = NULL,
    pending_candidate_ids = '[]'::jsonb, enqueued_candidate_ids = '[]'::jsonb,
    last_result = p_results, last_finished_at = now(), updated_at = now(),
    revision = revision + 1
    WHERE organization_id = p_organization_id AND instance_id = p_instance_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.begin_whatsapp_receipt_recovery(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_receipt_recovery(uuid,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_whatsapp_receipt_recovery(uuid,uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_receipt_recovery(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_receipt_recovery(uuid,uuid,uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_whatsapp_receipt_recovery(uuid,uuid,uuid,jsonb,uuid[]) TO service_role;
