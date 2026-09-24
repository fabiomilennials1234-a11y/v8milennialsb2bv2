-- Service-only worker claim control for a single WhatsApp ingress instance.
-- An absent control row means unpaused, revision zero (existing workers keep working).
CREATE TABLE public.whatsapp_ingress_worker_control (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid PRIMARY KEY REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  paused boolean NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_ingress_worker_control_org ON public.whatsapp_ingress_worker_control(organization_id);
ALTER TABLE public.whatsapp_ingress_worker_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_ingress_worker_control FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.whatsapp_ingress_worker_control TO service_role;
CREATE INDEX whatsapp_ingress_events_fifo_blocking ON public.whatsapp_ingress_events(instance_id, enqueue_sequence)
  WHERE status IN ('pending', 'processing', 'dead_letter');

CREATE FUNCTION public.set_whatsapp_ingress_worker_pause(
  p_organization_id uuid, p_instance_id uuid, p_paused boolean, p_expected_revision bigint
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_revision bigint; v_control_organization_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR p_paused IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid ingress worker control' USING ERRCODE = '22023';
  END IF;
  -- Same lock as claim: after pause commits, no new claim for this instance can pass.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instance_id::text, 29));
  -- Keep the resolved tenant stable through the control write. FOR SHARE also
  -- conflicts with non-key organization reassignment, unlike FOR KEY SHARE.
  PERFORM 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT revision, organization_id INTO v_revision, v_control_organization_id
    FROM public.whatsapp_ingress_worker_control
    WHERE instance_id = p_instance_id FOR UPDATE;
  IF FOUND AND v_control_organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'ingress worker control organization mismatch' USING ERRCODE = '42501';
  END IF;
  v_revision := coalesce(v_revision, 0);
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale ingress worker control revision' USING ERRCODE = '40001';
  END IF;
  IF NOT p_paused AND EXISTS (
    SELECT 1 FROM public.whatsapp_ingress_events
    WHERE instance_id = p_instance_id AND status = 'processing'
  ) THEN
    -- All processing rows, including expired and older-owner work, require
    -- manual reconciliation before resuming this instance.
    RAISE EXCEPTION 'ingress worker still processing' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.whatsapp_ingress_worker_control
    (organization_id, instance_id, paused, revision, updated_at)
    VALUES (p_organization_id, p_instance_id, p_paused, v_revision + 1, now())
    ON CONFLICT (instance_id) DO UPDATE SET
      paused = EXCLUDED.paused, revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at;
  RETURN v_revision + 1;
END $$;

CREATE FUNCTION public.get_whatsapp_ingress_handoff_snapshot(
  p_organization_id uuid, p_instance_id uuid
) RETURNS TABLE (
  paused boolean, revision bigint, pending_count bigint, processing_count bigint,
  expired_count bigint, dead_letter_count bigint, completed_count bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'invalid ingress snapshot scope' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances
    WHERE id = p_instance_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'instance organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_ingress_worker_control
    WHERE instance_id = p_instance_id AND organization_id <> p_organization_id
  ) THEN
    RAISE EXCEPTION 'ingress worker control organization mismatch' USING ERRCODE = '42501';
  END IF;
  -- Observation only: caller must coordinate Edge/provider cutover separately.
  RETURN QUERY SELECT
    coalesce(c.paused, false), coalesce(c.revision, 0),
    count(*) FILTER (WHERE e.status = 'pending'),
    count(*) FILTER (WHERE e.status = 'processing' AND e.lease_until >= now()),
    count(*) FILTER (WHERE e.status = 'processing' AND (e.lease_until < now() OR e.lease_until IS NULL)),
    count(*) FILTER (WHERE e.status = 'dead_letter'),
    count(*) FILTER (WHERE e.status = 'completed')
  FROM public.whatsapp_instances i
  LEFT JOIN public.whatsapp_ingress_worker_control c ON c.instance_id = i.id AND c.organization_id = p_organization_id
  LEFT JOIN public.whatsapp_ingress_events e ON e.instance_id = i.id AND e.organization_id = p_organization_id
  WHERE i.id = p_instance_id AND i.organization_id = p_organization_id
  GROUP BY c.paused, c.revision;
END $$;

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

REVOKE ALL ON FUNCTION public.set_whatsapp_ingress_worker_pause(uuid,uuid,boolean,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_whatsapp_ingress_handoff_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_ingress_worker_pause(uuid,uuid,boolean,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_ingress_handoff_snapshot(uuid,uuid) TO service_role;
-- Replacement preserves the original claim signature; state its ACL explicitly.
REVOKE ALL ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_ingress_events(uuid[],integer) TO service_role;
