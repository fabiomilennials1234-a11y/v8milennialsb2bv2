-- Restore the previous error contract; approval rows are unchanged.
-- Prefer the complete feature rollback if revision conflicts are occurring.
BEGIN;
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
    RAISE EXCEPTION 'grant_revision_conflict' USING ERRCODE = '40001';
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
NOTIFY pgrst, 'reload schema';
COMMIT;
