-- Authorize the trigger business stage as one explicit, atomic workflow scope.
BEGIN;
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields) <= 256
    AND coalesce(array_ndims(p_fields), 1) = 1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) AS requested(scope)
      WHERE scope IS NULL OR NOT (scope = ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage']::text[])
        OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_guided_condition_trigger_business_stage(
  p_workflow_id uuid,
  p_organization_id uuid,
  p_lead_id uuid,
  p_entry_id uuid,
  p_references jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_reference_count integer;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
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
  PERFORM 1 FROM public.workflows workflow
  JOIN public.workflow_data_grants grant_row
    ON grant_row.workflow_id = workflow.id AND grant_row.organization_id = workflow.organization_id
  WHERE workflow.id = p_workflow_id AND workflow.organization_id = p_organization_id
    AND grant_row.resource_scope = 'organization_leads'
    AND 'business.trigger.stage' = ANY(grant_row.fields)
    AND NOT public.org_access_blocked(workflow.organization_id)
  FOR SHARE OF workflow, grant_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT entry.* INTO v_entry FROM public.pipeline_entries entry
  WHERE entry.id = p_entry_id AND entry.organization_id = p_organization_id AND entry.lead_id = p_lead_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM (
    SELECT DISTINCT (reference->>'pipelineId')::uuid AS pipeline_id, (reference->>'stageId')::uuid AS stage_id
    FROM jsonb_array_elements(p_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = p_organization_id
  FOR SHARE OF pipeline, stage;
  SELECT count(*) INTO v_reference_count FROM (
    SELECT DISTINCT (reference->>'pipelineId')::uuid AS pipeline_id, (reference->>'stageId')::uuid AS stage_id
    FROM jsonb_array_elements(p_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = p_organization_id;
  IF v_reference_count <> (SELECT count(*) FROM (
    SELECT DISTINCT reference->>'pipelineId', reference->>'stageId' FROM jsonb_array_elements(p_references) reference
  ) requested) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  SELECT jsonb_build_object(
    'entry', jsonb_build_object('id', v_entry.id, 'pipeline_id', v_entry.pipeline_id, 'stage_id', v_entry.stage_id),
    'pipelines', jsonb_agg(DISTINCT jsonb_build_object('id', pipeline.id, 'name', pipeline.name)),
    'stages', jsonb_agg(DISTINCT jsonb_build_object('id', stage.id, 'name', stage.name, 'pipeline_id', stage.pipeline_id))
  ) INTO v_result
  FROM (
    SELECT DISTINCT (reference->>'pipelineId')::uuid AS pipeline_id, (reference->>'stageId')::uuid AS stage_id
    FROM jsonb_array_elements(p_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = p_organization_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_trigger_business_stage_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE v_references jsonb; v_invalid_node_ids text[]; v_reference_count integer;
BEGIN
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node ->> 'id', node -> 'data' -> 'guidedCondition'
    FROM jsonb_array_elements(NEW.definition -> 'nodes') node WHERE node ->> 'type' = 'condition'
    UNION ALL
    SELECT conditions.node_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition ->> 'kind' = 'group' THEN conditions.condition -> 'children' ELSE '[]'::jsonb END
    ) child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'operator', condition ->> 'operator',
      'pipelineId', condition ->> 'pipelineId', 'stageId', condition ->> 'stageId')), '[]'::jsonb)
    INTO v_references FROM conditions WHERE condition ->> 'field' = 'business.trigger.stage';
  IF jsonb_array_length(v_references) = 0 THEN RETURN NEW; END IF;
  IF NOT ('business.trigger.stage' = ANY(NEW.required_fields)) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT reference ->> 'nodeId' ORDER BY reference ->> 'nodeId') INTO v_invalid_node_ids
  FROM jsonb_array_elements(v_references) reference
  WHERE reference ->> 'operator' NOT IN ('equals', 'not_equals')
    OR reference ->> 'pipelineId' IS NULL OR reference ->> 'stageId' IS NULL
    OR reference ->> 'pipelineId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR reference ->> 'stageId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF cardinality(v_invalid_node_ids) > 0 THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
      DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
  END IF;
  PERFORM 1 FROM jsonb_array_elements(v_references) reference
  JOIN public.pipelines pipeline ON pipeline.id = (reference->>'pipelineId')::uuid AND pipeline.organization_id = NEW.organization_id
  JOIN public.pipeline_stages stage ON stage.id = (reference->>'stageId')::uuid AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = NEW.organization_id FOR SHARE OF pipeline, stage;
  SELECT count(*) INTO v_reference_count FROM (
    SELECT DISTINCT reference->>'pipelineId' AS pipeline_id, reference->>'stageId' AS stage_id
    FROM jsonb_array_elements(v_references) reference
  ) requested
  JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id::uuid AND pipeline.organization_id = NEW.organization_id
  JOIN public.pipeline_stages stage ON stage.id = requested.stage_id::uuid AND stage.pipeline_id = pipeline.id
    AND stage.organization_id = NEW.organization_id;
  IF v_reference_count <> (SELECT count(*) FROM (
    SELECT DISTINCT reference->>'pipelineId', reference->>'stageId' FROM jsonb_array_elements(v_references) reference
  ) requested) THEN
    SELECT array_agg(DISTINCT reference ->> 'nodeId' ORDER BY reference ->> 'nodeId') INTO v_invalid_node_ids
    FROM jsonb_array_elements(v_references) reference WHERE NOT EXISTS (
      SELECT 1 FROM public.pipelines pipeline JOIN public.pipeline_stages stage ON stage.pipeline_id = pipeline.id
      WHERE pipeline.id = (reference->>'pipelineId')::uuid AND pipeline.organization_id = NEW.organization_id
        AND stage.id = (reference->>'stageId')::uuid AND stage.organization_id = NEW.organization_id
    );
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
      DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_guided_trigger_business_stage_version() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_guided_trigger_business_stage_version ON public.workflow_guided_versions;
CREATE TRIGGER validate_guided_trigger_business_stage_version
BEFORE INSERT OR UPDATE OF definition, required_fields, organization_id ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_trigger_business_stage_version();
NOTIFY pgrst, 'reload schema';
COMMIT;
