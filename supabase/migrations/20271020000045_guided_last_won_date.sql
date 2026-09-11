-- Read the latest currently-won deal by its canonical outcome timestamp.
BEGIN;
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields) <= 256
    AND coalesce(array_ndims(p_fields), 1) = 1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) AS requested(scope)
      WHERE scope IS NULL OR NOT (scope = ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date']::text[])
        OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.test_guided_condition_last_won(p_organization_id uuid, p_lead_id uuid)
RETURNS TABLE(deal_id uuid, title text, won_at timestamptz, won_date text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF EXISTS (SELECT 1 FROM public.pipeline_entries pe JOIN public.deals d ON d.id=pe.deal_id
    WHERE pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id
      AND d.organization_id=p_organization_id AND d.deleted_at IS NULL AND d.outcome='won'
      AND (d.outcome_at IS NULL OR d.outcome_at > statement_timestamp())) THEN
    RAISE EXCEPTION 'source_unavailable' USING ERRCODE='22000';
  END IF;
  RETURN QUERY WITH eligible AS (
    SELECT DISTINCT d.id, d.title, d.outcome_at FROM public.pipeline_entries pe JOIN public.deals d ON d.id=pe.deal_id
    WHERE pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id
      AND d.organization_id=p_organization_id AND d.deleted_at IS NULL AND d.outcome='won'
  ) SELECT e.id, e.title, e.outcome_at, to_char(e.outcome_at AT TIME ZONE o.timezone, 'YYYY-MM-DD')
    FROM eligible e JOIN public.organizations o ON o.id=p_organization_id
    ORDER BY e.outcome_at DESC, e.id DESC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_last_won(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_last_won(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_guided_condition_last_won(p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid)
RETURNS TABLE(deal_id uuid, title text, won_at timestamptz, won_date text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g
    ON g.workflow_id=w.id AND g.organization_id=w.organization_id
    WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id
      AND g.resource_scope='organization_leads' AND ARRAY['business.last_won_date']::text[] <@ g.fields
      AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  PERFORM 1 FROM public.pipeline_entries pe JOIN public.deals d ON d.id=pe.deal_id
    WHERE pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id AND d.organization_id=p_organization_id
    FOR SHARE OF pe,d;
  IF EXISTS (SELECT 1 FROM public.pipeline_entries pe JOIN public.deals d ON d.id=pe.deal_id
    WHERE pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id
      AND d.organization_id=p_organization_id AND d.deleted_at IS NULL AND d.outcome='won'
      AND (d.outcome_at IS NULL OR d.outcome_at > statement_timestamp())) THEN
    RAISE EXCEPTION 'source_unavailable' USING ERRCODE='22000';
  END IF;
  RETURN QUERY WITH eligible AS (
    SELECT DISTINCT d.id, d.title, d.outcome_at FROM public.pipeline_entries pe JOIN public.deals d ON d.id=pe.deal_id
    WHERE pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id
      AND d.organization_id=p_organization_id AND d.deleted_at IS NULL AND d.outcome='won'
  ) SELECT e.id, e.title, e.outcome_at, to_char(e.outcome_at AT TIME ZONE o.timezone, 'YYYY-MM-DD')
    FROM eligible e JOIN public.organizations o ON o.id=p_organization_id
    ORDER BY e.outcome_at DESC, e.id DESC LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_last_won(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_last_won(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_last_won_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE
    ((condition->>'operator')=ANY(ARRAY['equals','not_equals','before','on_or_before','after','on_or_after','is_empty','is_not_empty'])) IS DISTINCT FROM true
    OR CASE WHEN (condition->>'operator')=ANY(ARRAY['is_empty','is_not_empty']) THEN false
      ELSE CASE WHEN (condition->>'value') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        THEN NOT (
          substring(condition->>'value',1,4)::integer BETWEEN 1 AND 9999
          AND substring(condition->>'value',6,2)::integer BETWEEN 1 AND 12
          AND substring(condition->>'value',9,2)::integer BETWEEN 1 AND CASE substring(condition->>'value',6,2)::integer
            WHEN 2 THEN CASE WHEN substring(condition->>'value',1,4)::integer % 400 = 0
              OR (substring(condition->>'value',1,4)::integer % 4 = 0 AND substring(condition->>'value',1,4)::integer % 100 <> 0) THEN 29 ELSE 28 END
            WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END
        ) ELSE true END END)
    INTO v_invalid FROM conditions WHERE condition->>'field'='business.last_won_date';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT 1 FROM conditions WHERE condition->>'field'='business.last_won_date'
    AND NOT ('business.last_won_date'=ANY(NEW.required_fields))) THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_guided_last_won_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_guided_last_won_version BEFORE INSERT OR UPDATE OF definition,required_fields
ON public.workflow_guided_versions FOR EACH ROW EXECUTE FUNCTION public.validate_guided_last_won_version();
NOTIFY pgrst,'reload schema';
COMMIT;
