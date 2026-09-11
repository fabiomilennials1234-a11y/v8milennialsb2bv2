-- Restore previous administrative authorization without deleting grants or drafts.
BEGIN;
DROP POLICY IF EXISTS workflow_data_grants_admin_read ON public.workflow_data_grants;
CREATE POLICY workflow_data_grants_admin_read ON public.workflow_data_grants
  FOR SELECT TO authenticated USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));
DROP POLICY IF EXISTS workflow_guided_drafts_admin_read ON public.workflow_guided_drafts;
CREATE POLICY workflow_guided_drafts_admin_read ON public.workflow_guided_drafts
  FOR SELECT TO authenticated USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));
CREATE OR REPLACE FUNCTION public.set_workflow_data_grant(
  p_workflow_id uuid, p_fields text[], p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_revision integer;
  v_grant public.workflow_data_grants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  -- Lock the parent, including the first approval when no grant row exists.
  -- Organization is resolved here, never accepted from the caller's payload.
  SELECT w.organization_id INTO v_organization_id
  FROM public.workflows w
  WHERE w.id = p_workflow_id
    AND w.organization_id IN (SELECT public.get_my_admin_organization_ids())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR NOT (p_fields <@ ARRAY['lead.name']::text[])
    OR array_position(p_fields, NULL) IS NOT NULL OR cardinality(p_fields) > 1
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT g.revision INTO v_revision FROM public.workflow_data_grants g
    WHERE g.workflow_id = p_workflow_id AND g.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'grant_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.workflow_data_grants AS g
    (workflow_id, organization_id, fields, revision, approved_by)
  VALUES (p_workflow_id, v_organization_id, p_fields, coalesce(v_revision, 0) + 1, auth.uid())
  ON CONFLICT (workflow_id) DO UPDATE SET
    fields = EXCLUDED.fields, revision = EXCLUDED.revision,
    approved_by = EXCLUDED.approved_by, updated_at = now()
  WHERE g.organization_id = EXCLUDED.organization_id
  RETURNING * INTO v_grant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('workflow_id', v_grant.workflow_id,
    'organization_id', v_grant.organization_id, 'resource_scope', v_grant.resource_scope,
    'fields', v_grant.fields, 'revision', v_grant.revision);
END;
$$;
CREATE OR REPLACE FUNCTION public.save_guided_workflow_draft(
  p_workflow_id uuid, p_definition jsonb, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_revision integer;
  v_saved public.workflow_guided_drafts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT w.organization_id INTO v_organization_id FROM public.workflows w
  WHERE w.id = p_workflow_id
    AND w.organization_id IN (SELECT public.get_my_admin_organization_ids())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_draft' USING ERRCODE = '22023';
  END IF;
  SELECT d.revision INTO v_revision FROM public.workflow_guided_drafts d
    WHERE d.workflow_id = p_workflow_id AND d.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'draft_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.workflow_guided_drafts AS d
    (workflow_id, organization_id, definition, revision, updated_by)
  VALUES (p_workflow_id, v_organization_id, p_definition, coalesce(v_revision, 0) + 1, auth.uid())
  ON CONFLICT (workflow_id) DO UPDATE SET
    definition = EXCLUDED.definition, revision = EXCLUDED.revision,
    updated_by = EXCLUDED.updated_by, updated_at = now()
  WHERE d.organization_id = EXCLUDED.organization_id
  RETURNING * INTO v_saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('workflow_id', v_saved.workflow_id, 'revision', v_saved.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_guided_workflow_draft(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_guided_workflow_draft(uuid, jsonb, integer) TO authenticated;
DROP FUNCTION IF EXISTS public.can_administer_guided_workflow(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
