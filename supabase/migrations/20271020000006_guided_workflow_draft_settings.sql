-- Rules and editor settings share the same optimistic revision and transaction.
BEGIN;
ALTER TABLE public.workflow_guided_drafts ADD COLUMN IF NOT EXISTS settings jsonb
  CHECK (settings IS NULL OR jsonb_typeof(settings) = 'object');
CREATE OR REPLACE FUNCTION public.save_guided_workflow_draft_with_settings(
  p_workflow_id uuid, p_definition jsonb, p_expected_revision integer, p_settings jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_draft_settings' USING ERRCODE = '22023';
  END IF;
  -- Reuse current authorization and the parent-row lock. It remains held
  -- through this update; a concurrent save cannot mix rules and settings.
  v_result := public.save_guided_workflow_draft(p_workflow_id, p_definition, p_expected_revision);
  UPDATE public.workflow_guided_drafts d SET settings = p_settings
  FROM public.workflows w
  WHERE d.workflow_id = p_workflow_id AND w.id = d.workflow_id
    AND d.organization_id = w.organization_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_guided_workflow_draft_with_settings(uuid, jsonb, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_guided_workflow_draft_with_settings(uuid, jsonb, integer, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
