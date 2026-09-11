BEGIN;
CREATE OR REPLACE FUNCTION public.guard_guided_workflow_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_fields text[];
BEGIN
  IF NOT NEW.is_active OR NOT EXISTS (SELECT 1 FROM public.workflow_guided_drafts d WHERE d.workflow_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NOT public.can_administer_guided_workflow(NEW.organization_id) OR public.org_access_blocked(NEW.organization_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT v.required_fields INTO v_fields FROM public.workflow_guided_publications p
    JOIN public.workflow_guided_versions v ON v.id = p.version_id AND v.workflow_id = p.workflow_id AND v.organization_id = p.organization_id
    WHERE p.workflow_id = NEW.id AND p.organization_id = NEW.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'guided_publication_required' USING ERRCODE = '42501'; END IF;
  IF cardinality(v_fields) > 0 THEN
    PERFORM 1 FROM public.workflow_data_grants g WHERE g.workflow_id = NEW.id AND g.organization_id = NEW.organization_id
      AND g.resource_scope = 'organization_leads' AND v_fields <@ g.fields FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_guided_workflow_activation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS guard_guided_workflow_activation ON public.workflows;
CREATE TRIGGER guard_guided_workflow_activation BEFORE UPDATE OF is_active ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.guard_guided_workflow_activation();

CREATE OR REPLACE FUNCTION public.set_guided_workflow_active(p_workflow_id uuid, p_active boolean, p_expected_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid; v_version uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023'; END IF;
  SELECT w.organization_id INTO v_org FROM public.workflows w WHERE w.id = p_workflow_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_administer_guided_workflow(v_org) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_guided_drafts d WHERE d.workflow_id = p_workflow_id AND d.organization_id = v_org) THEN
    RAISE EXCEPTION 'guided_draft_required' USING ERRCODE = '42501';
  END IF;
  SELECT p.version_id INTO v_version FROM public.workflow_guided_publications p WHERE p.workflow_id = p_workflow_id AND p.organization_id = v_org;
  IF p_active THEN
    IF v_version IS NULL THEN RAISE EXCEPTION 'guided_publication_required' USING ERRCODE = '42501'; END IF;
    IF v_version IS DISTINCT FROM p_expected_version_id THEN RAISE EXCEPTION 'publication_changed' USING ERRCODE = 'PT409'; END IF;
  END IF;
  -- Trigger applies the same current grant/authority checks to direct updates.
  UPDATE public.workflows SET is_active = p_active WHERE id = p_workflow_id AND organization_id = v_org;
  RETURN jsonb_build_object('workflow_id', p_workflow_id, 'is_active', p_active, 'version_id', v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.set_guided_workflow_active(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_guided_workflow_active(uuid, boolean, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
