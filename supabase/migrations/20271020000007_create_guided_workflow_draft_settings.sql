BEGIN;
CREATE OR REPLACE FUNCTION public.create_guided_workflow_draft_with_settings(
  p_workflow_id uuid, p_organization_id uuid, p_definition jsonb, p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings -> 'name') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid_draft_settings' USING ERRCODE = '22023';
  END IF;
  v_result := public.create_guided_workflow_draft(
    p_workflow_id, p_organization_id, p_settings ->> 'name', p_definition
  );
  UPDATE public.workflow_guided_drafts SET settings = p_settings
  WHERE workflow_id = p_workflow_id AND organization_id = p_organization_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_guided_workflow_draft_with_settings(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_guided_workflow_draft_with_settings(uuid, uuid, jsonb, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
