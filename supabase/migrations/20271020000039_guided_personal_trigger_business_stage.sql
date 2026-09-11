-- Read the exact business selected by a personal guided-condition test.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_trigger_business_stage(
  p_organization_id uuid,
  p_lead_id uuid,
  p_entry_id uuid,
  p_references jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_reference_count integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_entry_id IS NULL OR p_references IS NULL OR jsonb_typeof(p_references) <> 'array'
    OR jsonb_array_length(p_references) = 0 OR jsonb_array_length(p_references) > 256
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_references) reference
      WHERE jsonb_typeof(reference) <> 'object'
        OR jsonb_typeof(reference->'pipelineId') <> 'string'
        OR jsonb_typeof(reference->'stageId') <> 'string'
        OR (reference->>'pipelineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (reference->>'stageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;

  SELECT entry.* INTO v_entry
  FROM public.pipeline_entries entry
  WHERE entry.id = p_entry_id
    AND entry.organization_id = p_organization_id
    AND entry.lead_id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404';
  END IF;

  SELECT count(*) INTO v_reference_count
  FROM (
    SELECT DISTINCT (reference->>'pipelineId')::uuid AS pipeline_id,
      (reference->>'stageId')::uuid AS stage_id
    FROM jsonb_array_elements(p_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id
    AND pipeline.organization_id = p_organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id
    AND stage.organization_id = p_organization_id
    AND stage.pipeline_id = pipeline.id;
  IF v_reference_count <> (
    SELECT count(*) FROM (
      SELECT DISTINCT reference->>'pipelineId', reference->>'stageId'
      FROM jsonb_array_elements(p_references) reference
    ) requested
  ) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;

  SELECT jsonb_build_object(
    'entry', jsonb_build_object('id', v_entry.id, 'pipeline_id', v_entry.pipeline_id, 'stage_id', v_entry.stage_id),
    'pipelines', COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', pipeline.id, 'name', pipeline.name)), '[]'::jsonb),
    'stages', COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', stage.id, 'name', stage.name, 'pipeline_id', stage.pipeline_id)), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT DISTINCT (reference->>'pipelineId')::uuid AS pipeline_id,
      (reference->>'stageId')::uuid AS stage_id
    FROM jsonb_array_elements(p_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = p_organization_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
