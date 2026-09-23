-- Source filtering stays disabled until every webhook writer runs the coordinated adapter.
CREATE TABLE public.uazapi_group_policy (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 desired_capture boolean NOT NULL,
 filter_suspended boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.uazapi_group_webhook_state (
 instance_id uuid PRIMARY KEY REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0,
 excluded boolean,
 desired_excluded boolean,
 lease_token uuid,
 lease_started_at timestamptz,
 verified_at timestamptz
);
CREATE INDEX uazapi_group_state_org_idx ON public.uazapi_group_webhook_state(organization_id);
ALTER TABLE public.uazapi_group_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uazapi_group_webhook_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.uazapi_group_policy, public.uazapi_group_webhook_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.uazapi_group_policy, public.uazapi_group_webhook_state TO service_role;
-- Deliberately no authenticated policies: only authenticated server operations may access state.

CREATE FUNCTION public.request_uazapi_group_capture(p_organization_id uuid, p_capture boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF p_capture IS NULL THEN RAISE EXCEPTION 'capture_required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization_not_found'; END IF;
 IF EXISTS (SELECT 1 FROM public.uazapi_group_webhook_state WHERE organization_id=p_organization_id AND lease_token IS NOT NULL) THEN
  RAISE EXCEPTION 'webhook_reconciliation_in_progress_or_uncertain';
 END IF;
 INSERT INTO public.uazapi_group_policy(organization_id,desired_capture) VALUES(p_organization_id,p_capture)
 ON CONFLICT(organization_id) DO UPDATE SET desired_capture=EXCLUDED.desired_capture, filter_suspended=false, revision=uazapi_group_policy.revision+1, updated_at=now();
 INSERT INTO public.uazapi_group_webhook_state(instance_id,organization_id)
 SELECT id,organization_id FROM public.whatsapp_instances WHERE organization_id=p_organization_id AND provider='uazapi'
 ON CONFLICT(instance_id) DO NOTHING;
 -- Turning capture off cannot lose an enabled feature. Turning it on waits for verified removal.
 IF NOT p_capture THEN UPDATE public.organizations SET capture_groups=false WHERE id=p_organization_id;
 ELSIF NOT EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE organization_id=p_organization_id AND provider='uazapi') THEN
  UPDATE public.organizations SET capture_groups=true WHERE id=p_organization_id;
 END IF;
 RETURN jsonb_build_object('reconciliation_required',EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE organization_id=p_organization_id AND provider='uazapi'));
END $$;

CREATE FUNCTION public.prepare_uazapi_group_webhook(p_instance_id uuid,p_organization_id uuid,p_filter_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_capture boolean; intended_capture boolean; current_revision bigint; suspended boolean; requested_exclusion boolean; token uuid; state public.uazapi_group_webhook_state%ROWTYPE;
BEGIN
 SELECT capture_groups INTO current_capture FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization_not_found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE id=p_instance_id AND organization_id=p_organization_id AND provider='uazapi') THEN RAISE EXCEPTION 'instance_scope_denied'; END IF;
 SELECT desired_capture,revision,filter_suspended INTO intended_capture,current_revision,suspended FROM public.uazapi_group_policy WHERE organization_id=p_organization_id;
 -- Explicit enrollment is required. A global flag must not enroll unrelated organizations.
 IF current_revision IS NULL AND NOT EXISTS(SELECT 1 FROM public.uazapi_group_webhook_state WHERE instance_id=p_instance_id) THEN RETURN NULL; END IF;
 IF current_revision IS NULL THEN
  INSERT INTO public.uazapi_group_policy(organization_id,desired_capture) VALUES(p_organization_id,current_capture IS DISTINCT FROM false)
  RETURNING desired_capture,revision INTO intended_capture,current_revision;
 END IF;
 INSERT INTO public.uazapi_group_webhook_state(instance_id,organization_id) VALUES(p_instance_id,p_organization_id) ON CONFLICT(instance_id) DO NOTHING;
 SELECT * INTO state FROM public.uazapi_group_webhook_state WHERE instance_id=p_instance_id FOR UPDATE;
 IF state.organization_id<>p_organization_id THEN RAISE EXCEPTION 'instance_scope_denied'; END IF;
 -- No automatic lease stealing. A timed-out HTTP writer can still complete remotely.
 IF state.lease_token IS NOT NULL THEN RAISE EXCEPTION 'webhook_reconciliation_in_progress_or_uncertain'; END IF;
 requested_exclusion:=coalesce(p_filter_enabled,false) AND NOT coalesce(suspended,false) AND intended_capture=false AND current_capture IS NOT DISTINCT FROM false;
 token:=gen_random_uuid();
 UPDATE public.uazapi_group_webhook_state SET lease_token=token,lease_started_at=now(),desired_excluded=requested_exclusion,excluded=NULL,verified_at=NULL,revision=current_revision WHERE instance_id=p_instance_id;
 RETURN jsonb_build_object('token',token,'revision',current_revision,'exclude_groups',requested_exclusion);
END $$;

CREATE FUNCTION public.finish_uazapi_group_webhook(p_instance_id uuid,p_organization_id uuid,p_token uuid,p_revision bigint,p_excluded boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE intended_capture boolean;
BEGIN
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 SELECT desired_capture INTO intended_capture FROM public.uazapi_group_policy WHERE organization_id=p_organization_id AND revision=p_revision;
 IF NOT FOUND OR p_excluded IS NULL THEN RAISE EXCEPTION 'stale_or_unverified_webhook'; END IF;
 IF intended_capture AND p_excluded THEN RAISE EXCEPTION 'group_capture_cannot_exclude_groups'; END IF;
 UPDATE public.uazapi_group_webhook_state SET excluded=p_excluded,verified_at=now(),lease_token=NULL,lease_started_at=NULL
 WHERE instance_id=p_instance_id AND organization_id=p_organization_id AND lease_token=p_token AND revision=p_revision AND desired_excluded=p_excluded;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_webhook_lease'; END IF;
 IF intended_capture AND NOT EXISTS(
  SELECT 1 FROM public.whatsapp_instances i LEFT JOIN public.uazapi_group_webhook_state s ON s.instance_id=i.id AND s.organization_id=i.organization_id
  WHERE i.organization_id=p_organization_id AND i.provider='uazapi' AND (s.excluded IS DISTINCT FROM false OR s.lease_token IS NOT NULL)
 ) THEN
  UPDATE public.organizations SET capture_groups=true WHERE id=p_organization_id;
  RETURN true;
 END IF;
 RETURN false;
END $$;

CREATE FUNCTION public.guard_uazapi_group_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.capture_groups IS DISTINCT FROM OLD.capture_groups AND EXISTS(
  SELECT 1 FROM public.uazapi_group_policy WHERE organization_id=NEW.id AND desired_capture IS DISTINCT FROM (NEW.capture_groups IS DISTINCT FROM false)
 ) THEN RAISE EXCEPTION 'use_request_uazapi_group_capture_for_managed_organization'; END IF;
 IF NEW.capture_groups IS DISTINCT FROM false AND OLD.capture_groups=false AND EXISTS(
  SELECT 1 FROM public.uazapi_group_webhook_state WHERE organization_id=NEW.id AND (excluded IS DISTINCT FROM false OR lease_token IS NOT NULL)
 ) THEN RAISE EXCEPTION 'reconcile_group_webhooks_before_enabling_capture'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_uazapi_group_capture BEFORE UPDATE OF capture_groups ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.guard_uazapi_group_capture();

-- Exceptional recovery only after the old process/request is confirmed terminated.
-- It does NOT declare success or enable groups: the next reconciliation must remove and verify.
CREATE FUNCTION public.recover_uazapi_group_webhook(p_instance_id uuid,p_organization_id uuid,p_token uuid,p_previous_writer_stopped boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_previous_writer_stopped IS DISTINCT FROM true THEN RAISE EXCEPTION 'previous_writer_must_be_stopped'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 UPDATE public.uazapi_group_webhook_state SET lease_token=NULL,lease_started_at=NULL,excluded=NULL,verified_at=NULL
 WHERE instance_id=p_instance_id AND organization_id=p_organization_id AND lease_token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_webhook_lease'; END IF;
 UPDATE public.uazapi_group_policy SET filter_suspended=true,revision=revision+1,updated_at=now() WHERE organization_id=p_organization_id;
END $$;

REVOKE ALL ON FUNCTION public.request_uazapi_group_capture(uuid,boolean), public.prepare_uazapi_group_webhook(uuid,uuid,boolean), public.finish_uazapi_group_webhook(uuid,uuid,uuid,bigint,boolean), public.recover_uazapi_group_webhook(uuid,uuid,uuid,boolean), public.guard_uazapi_group_capture() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_uazapi_group_capture(uuid,boolean), public.prepare_uazapi_group_webhook(uuid,uuid,boolean), public.finish_uazapi_group_webhook(uuid,uuid,uuid,bigint,boolean), public.recover_uazapi_group_webhook(uuid,uuid,uuid,boolean) TO service_role;
