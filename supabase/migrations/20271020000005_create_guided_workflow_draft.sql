-- Create only an inactive shell and a separate draft, atomically.
-- The selected organization is untrusted until current administration is checked.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_guided_workflow_draft(
  p_workflow_id uuid, p_organization_id uuid, p_name text, p_definition jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_guided_workflow(p_organization_id) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_workflow_id IS NULL OR p_organization_id IS NULL
    OR p_name IS NULL OR btrim(p_name) = ''
    OR jsonb_typeof(p_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_draft' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.workflows(id, organization_id, name, is_active, trigger_type, definition, created_by)
  VALUES (p_workflow_id, p_organization_id, p_name, false, 'manual', '{"nodes":[],"edges":[]}'::jsonb, auth.uid());
  INSERT INTO public.workflow_guided_drafts(workflow_id, organization_id, definition, revision, updated_by)
  VALUES (p_workflow_id, p_organization_id, p_definition, 1, auth.uid());
  RETURN jsonb_build_object('workflow_id', p_workflow_id, 'revision', 1);
END;
$$;
REVOKE ALL ON FUNCTION public.create_guided_workflow_draft(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_guided_workflow_draft(uuid, uuid, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
