-- Per-instance Edge admission gate. A missing row is deliberately uninitialized:
-- callers must initialize it before any inline effect or queued admission.
CREATE TABLE public.whatsapp_edge_execution_gate (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid PRIMARY KEY REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('inline', 'queued')),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_edge_execution_gate_org ON public.whatsapp_edge_execution_gate(organization_id);
ALTER TABLE public.whatsapp_edge_execution_gate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_edge_execution_gate FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_edge_execution_gate TO service_role;

-- Tickets are durable evidence of inline work that may have reached external
-- effects. No expiry or automatic cleanup: an operator must reconcile loss.
CREATE TABLE public.whatsapp_edge_execution_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_edge_execution_tickets_instance ON public.whatsapp_edge_execution_tickets(instance_id);
CREATE INDEX whatsapp_edge_execution_tickets_org ON public.whatsapp_edge_execution_tickets(organization_id);
ALTER TABLE public.whatsapp_edge_execution_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_edge_execution_tickets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_edge_execution_tickets TO service_role;

CREATE FUNCTION public.begin_whatsapp_edge_execution(
  p_organization_id uuid, p_instance_id uuid, p_payload jsonb, p_path_instance_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mode text; v_gate_org uuid; v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL
    OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR pg_catalog.octet_length(p_payload::text) > 2097152
    OR pg_catalog.length(coalesce(p_path_instance_id, '')) > 200 THEN
    RAISE EXCEPTION 'invalid edge execution admission' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT mode, organization_id INTO v_mode, v_gate_org
    FROM public.whatsapp_edge_execution_gate WHERE instance_id = p_instance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'edge execution gate uninitialized' USING ERRCODE = '55000';
  END IF;
  IF v_gate_org <> p_organization_id THEN
    RAISE EXCEPTION 'edge execution gate organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_mode = 'inline' THEN
    -- Dead letters and expired leases are still unresolved work. Never let
    -- inline effects overtake a queued delivery.
    IF EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
      WHERE instance_id = p_instance_id AND status <> 'completed') THEN
      RAISE EXCEPTION 'edge inline admission blocked by inbox' USING ERRCODE = '55000';
    END IF;
    -- A failed inline effect leaves a permanent ticket. Bound retained
    -- evidence per instance until an operator reconciles it.
    IF (SELECT count(*) FROM public.whatsapp_edge_execution_tickets
      WHERE instance_id = p_instance_id) >= 64 THEN
      RAISE EXCEPTION 'edge execution ticket capacity exhausted' USING ERRCODE = '54000';
    END IF;
    INSERT INTO public.whatsapp_edge_execution_tickets(organization_id, instance_id)
      VALUES (p_organization_id, p_instance_id) RETURNING id INTO v_id;
    RETURN pg_catalog.jsonb_build_object('mode', 'inline', 'ticket_id', v_id);
  END IF;
  -- This protocol handles messages_update only. Caller checks event type;
  -- provider envelope fields vary and must not drive the DB event name.
  v_id := public.enqueue_whatsapp_ingress_event(
    p_organization_id, p_instance_id, 'messages_update', p_payload, p_path_instance_id);
  RETURN pg_catalog.jsonb_build_object('mode', 'queued', 'event_id', v_id);
END $$;

CREATE FUNCTION public.complete_whatsapp_edge_execution(
  p_organization_id uuid, p_instance_id uuid, p_ticket_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket_org uuid; v_ticket_instance uuid; v_gate_org uuid;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'invalid edge execution completion' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_gate_org FROM public.whatsapp_edge_execution_gate
    WHERE instance_id = p_instance_id;
  IF NOT FOUND OR v_gate_org <> p_organization_id THEN
    RAISE EXCEPTION 'edge execution gate scope mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id, instance_id INTO v_ticket_org, v_ticket_instance
    FROM public.whatsapp_edge_execution_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_ticket_org <> p_organization_id OR v_ticket_instance <> p_instance_id THEN
    RAISE EXCEPTION 'edge execution ticket scope mismatch' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.whatsapp_edge_execution_tickets WHERE id = p_ticket_id;
  RETURN true;
END $$;

CREATE FUNCTION public.set_whatsapp_edge_execution_mode(
  p_organization_id uuid, p_instance_id uuid, p_mode text, p_expected_revision bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mode text; v_revision bigint; v_gate_org uuid;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL
    OR p_mode IS NULL OR p_mode NOT IN ('inline', 'queued')
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid edge execution mode' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT mode, revision, organization_id INTO v_mode, v_revision, v_gate_org
    FROM public.whatsapp_edge_execution_gate WHERE instance_id = p_instance_id FOR UPDATE;
  IF FOUND AND v_gate_org <> p_organization_id THEN
    RAISE EXCEPTION 'edge execution gate organization mismatch' USING ERRCODE = '42501';
  END IF;
  v_revision := coalesce(v_revision, 0);
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale edge execution gate revision' USING ERRCODE = '40001';
  END IF;
  IF v_revision = 0 AND p_mode <> 'inline' THEN
    RAISE EXCEPTION 'edge execution gate must initialize inline' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'inline' AND (
    EXISTS (SELECT 1 FROM public.whatsapp_ingress_events
      WHERE instance_id = p_instance_id AND status <> 'completed')
    OR EXISTS (SELECT 1 FROM public.whatsapp_edge_execution_tickets
      WHERE instance_id = p_instance_id)
  ) THEN
    RAISE EXCEPTION 'edge inline mode requires drained work' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.whatsapp_edge_execution_gate
    (organization_id, instance_id, mode, revision, updated_at)
    VALUES (p_organization_id, p_instance_id, p_mode, v_revision + 1, now())
    ON CONFLICT (instance_id) DO UPDATE SET
      mode = EXCLUDED.mode, revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at;
  RETURN v_revision + 1;
END $$;

-- SQL32 claim semantics remain intact for unregistered legacy instances.
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

REVOKE ALL ON FUNCTION public.begin_whatsapp_edge_execution(uuid,uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_whatsapp_edge_execution(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_whatsapp_edge_execution_mode(uuid,uuid,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_edge_execution(uuid,uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_whatsapp_edge_execution(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_edge_execution_mode(uuid,uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) TO service_role;
