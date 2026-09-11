-- Query every current business for one lead without using a UI/kanban page as the universe.
BEGIN;
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields) <= 256
    AND coalesce(array_ndims(p_fields), 1) = 1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) AS requested(scope)
      WHERE scope IS NULL OR NOT (scope = ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value']::text[])
        OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.test_guided_condition_business_candidates(
  p_organization_id uuid, p_lead_id uuid, p_fields text[], p_stage_references jsonb
) RETURNS TABLE(id uuid, pipeline_id uuid, pipeline_name text, stage_id uuid, value numeric, outcome text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_reference_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 3
    OR NOT ('business.exists.lifecycle' = ANY(p_fields)) OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['business.exists.lifecycle','business.exists.stage','business.exists.value']::text[])
    OR p_stage_references IS NULL OR jsonb_typeof(p_stage_references) <> 'array' OR jsonb_array_length(p_stage_references) > 256
    OR (('business.exists.stage' = ANY(p_fields)) IS DISTINCT FROM (jsonb_array_length(p_stage_references) > 0))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_stage_references) reference
      WHERE jsonb_typeof(reference) <> 'object'
        OR (reference->>'pipelineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (reference->>'stageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.leads lead WHERE lead.id = p_lead_id AND lead.organization_id = p_organization_id AND lead.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT count(*) INTO v_reference_count FROM (SELECT DISTINCT (reference->>'pipelineId')::uuid pipeline_id,
    (reference->>'stageId')::uuid stage_id FROM jsonb_array_elements(p_stage_references) reference) requested
    JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
    JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id AND stage.organization_id = p_organization_id;
  IF v_reference_count <> (SELECT count(*) FROM (SELECT DISTINCT reference->>'pipelineId', reference->>'stageId'
    FROM jsonb_array_elements(p_stage_references) reference) requested) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT entry.id,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN entry.pipeline_id ELSE NULL END,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN pipeline.name ELSE NULL END,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN entry.stage_id ELSE NULL END,
    CASE WHEN 'business.exists.value' = ANY(p_fields) THEN deal.value ELSE NULL END,
    coalesce(deal.outcome, 'open')
  FROM public.pipeline_entries entry
  JOIN public.pipelines pipeline ON pipeline.id = entry.pipeline_id AND pipeline.organization_id = p_organization_id
  LEFT JOIN public.deals deal ON deal.id = entry.deal_id AND deal.organization_id = p_organization_id AND deal.deleted_at IS NULL
  WHERE entry.organization_id = p_organization_id AND entry.lead_id = p_lead_id ORDER BY entry.id;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_business_candidates(uuid,uuid,text[],jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_guided_condition_business_candidates(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[], p_stage_references jsonb
) RETURNS TABLE(id uuid, pipeline_id uuid, pipeline_name text, stage_id uuid, value numeric, outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reference_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 3
    OR NOT ('business.exists.lifecycle' = ANY(p_fields)) OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['business.exists.lifecycle','business.exists.stage','business.exists.value']::text[])
    OR p_stage_references IS NULL OR jsonb_typeof(p_stage_references) <> 'array' OR jsonb_array_length(p_stage_references) > 256
    OR (('business.exists.stage' = ANY(p_fields)) IS DISTINCT FROM (jsonb_array_length(p_stage_references) > 0))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_stage_references) reference
      WHERE jsonb_typeof(reference) <> 'object'
        OR (reference->>'pipelineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (reference->>'stageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.workflows workflow JOIN public.workflow_data_grants grant_row
    ON grant_row.workflow_id = workflow.id AND grant_row.organization_id = workflow.organization_id
  WHERE workflow.id = p_workflow_id AND workflow.organization_id = p_organization_id
    AND grant_row.resource_scope = 'organization_leads' AND p_fields <@ grant_row.fields
    AND NOT public.org_access_blocked(workflow.organization_id) FOR SHARE OF workflow, grant_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.leads lead WHERE lead.id = p_lead_id AND lead.organization_id = p_organization_id AND lead.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  PERFORM 1 FROM public.pipeline_entries entry JOIN public.pipelines pipeline ON pipeline.id = entry.pipeline_id
    WHERE entry.organization_id = p_organization_id AND entry.lead_id = p_lead_id AND pipeline.organization_id = p_organization_id FOR SHARE OF entry, pipeline;
  PERFORM 1 FROM public.deals deal JOIN public.pipeline_entries entry ON entry.deal_id = deal.id
    WHERE entry.organization_id = p_organization_id AND entry.lead_id = p_lead_id AND deal.organization_id = p_organization_id AND deal.deleted_at IS NULL FOR SHARE OF deal;
  SELECT count(*) INTO v_reference_count FROM (SELECT DISTINCT (reference->>'pipelineId')::uuid pipeline_id,
    (reference->>'stageId')::uuid stage_id FROM jsonb_array_elements(p_stage_references) reference) requested
    JOIN public.pipelines pipeline ON pipeline.id = requested.pipeline_id AND pipeline.organization_id = p_organization_id
    JOIN public.pipeline_stages stage ON stage.id = requested.stage_id AND stage.pipeline_id = pipeline.id AND stage.organization_id = p_organization_id;
  IF v_reference_count <> (SELECT count(*) FROM (SELECT DISTINCT reference->>'pipelineId', reference->>'stageId'
    FROM jsonb_array_elements(p_stage_references) reference) requested) THEN RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422'; END IF;
  RETURN QUERY SELECT entry.id,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN entry.pipeline_id ELSE NULL END,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN pipeline.name ELSE NULL END,
    CASE WHEN 'business.exists.stage' = ANY(p_fields) THEN entry.stage_id ELSE NULL END,
    CASE WHEN 'business.exists.value' = ANY(p_fields) THEN deal.value ELSE NULL END, coalesce(deal.outcome, 'open')
  FROM public.pipeline_entries entry
  JOIN public.pipelines pipeline ON pipeline.id = entry.pipeline_id AND pipeline.organization_id = p_organization_id
  LEFT JOIN public.deals deal ON deal.id = entry.deal_id AND deal.organization_id = p_organization_id AND deal.deleted_at IS NULL
  WHERE entry.organization_id = p_organization_id AND entry.lead_id = p_lead_id ORDER BY entry.id;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_business_candidates(uuid,uuid,uuid,text[],jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_business_existence_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_invalid text[]; v_refs jsonb;
BEGIN
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node->>'id', node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type' = 'condition'
    UNION ALL SELECT conditions.node_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind' = 'group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ), queries AS (SELECT * FROM conditions WHERE condition->>'kind' = 'business_exists')
  SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE
    ((condition->>'lifecycle') = ANY(ARRAY['open','won','lost','all'])) IS DISTINCT FROM true
    OR ((condition->>'match') = ANY(ARRAY['all','any'])) IS DISTINCT FROM true
    OR jsonb_typeof(condition->'children') IS DISTINCT FROM 'array'
    OR CASE WHEN jsonb_typeof(condition->'children') = 'array'
      THEN jsonb_array_length(condition->'children') NOT BETWEEN 1 AND 256 ELSE false END)
  INTO v_invalid FROM queries;
  IF cardinality(v_invalid) > 0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023', DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node->>'id', node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type' = 'condition'
    UNION ALL SELECT conditions.node_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind' = 'group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ), children AS (
    SELECT node_id, condition->>'id' query_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN condition->>'kind'='business_exists' AND jsonb_typeof(condition->'children')='array'
        THEN condition->'children' ELSE '[]'::jsonb END) child
    WHERE condition->>'kind'='business_exists'
  )
  SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE
    jsonb_typeof(child) IS DISTINCT FROM 'object'
    OR child->>'version' IS DISTINCT FROM '1'
    OR coalesce(child->>'id','') = ''
    OR child->>'id' = query_id
    OR CASE child->>'field'
      WHEN 'business.stage' THEN
        ((child->>'operator') = ANY(ARRAY['equals','not_equals'])) IS DISTINCT FROM true
        OR (child->>'pipelineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (child->>'stageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      WHEN 'business.value' THEN
        ((child->>'operator') = ANY(ARRAY['equals','not_equals','greater_than','greater_than_or_equal','less_than','less_than_or_equal','is_empty','is_not_empty'])) IS DISTINCT FROM true
        OR CASE WHEN (child->>'operator') = ANY(ARRAY['is_empty','is_not_empty']) THEN false
          ELSE jsonb_typeof(child->'value') IS DISTINCT FROM 'number' END
      ELSE true
    END)
  INTO v_invalid FROM children;
  IF cardinality(v_invalid) > 0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023', DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF EXISTS (WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node->>'id', node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type' = 'condition'
    UNION ALL SELECT conditions.node_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind' = 'group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT 1 FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN condition->>'kind'='business_exists' AND jsonb_typeof(condition->'children')='array'
      THEN condition->'children' ELSE '[]'::jsonb END) child
    WHERE condition->>'kind'='business_exists' GROUP BY node_id, condition->>'id'
    HAVING count(*) <> count(DISTINCT child->>'id')) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023';
  END IF;
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node->>'id', node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type' = 'condition'
    UNION ALL SELECT conditions.node_id, child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind' = 'group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId',node_id,'pipelineId',child->>'pipelineId','stageId',child->>'stageId')),'[]'::jsonb)
    INTO v_refs FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(condition->'children')='array' THEN condition->'children' ELSE '[]'::jsonb END) child
    WHERE condition->>'kind'='business_exists' AND child->>'field'='business.stage';
  IF jsonb_array_length(v_refs)>0 AND NOT ('business.exists.stage'=ANY(NEW.required_fields)) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_refs) r
    WHERE (r->>'pipelineId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (r->>'stageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE='PT422'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_refs) r WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages s
    WHERE s.id=(r->>'stageId')::uuid AND s.pipeline_id=(r->>'pipelineId')::uuid AND s.organization_id=NEW.organization_id)) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE='PT422'; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT 1 FROM conditions WHERE condition->>'kind'='business_exists' AND NOT ('business.exists.lifecycle'=ANY(NEW.required_fields))) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT 1 FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(condition->'children')='array' THEN condition->'children' ELSE '[]'::jsonb END) child
    WHERE condition->>'kind'='business_exists' AND child->>'field'='business.value' AND NOT ('business.exists.value'=ANY(NEW.required_fields))) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_guided_business_existence_version() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validate_guided_business_existence_version BEFORE INSERT OR UPDATE OF definition,required_fields
ON public.workflow_guided_versions FOR EACH ROW EXECUTE FUNCTION public.validate_guided_business_existence_version();
NOTIFY pgrst, 'reload schema';
COMMIT;
