-- Follow-up criteria with explicit ownership, lifecycle and date meaning.
BEGIN;

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text','message.waiting.elapsed','activity.follow_up']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE INDEX IF NOT EXISTS idx_follow_ups_guided_lead_pending
  ON public.follow_ups(organization_id,lead_id,due_date,id)
  WHERE pipeline_entry_id IS NULL AND completed_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_guided_lead_completed
  ON public.follow_ups(organization_id,lead_id,completed_at,id)
  WHERE pipeline_entry_id IS NULL AND completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_guided_business_pending
  ON public.follow_ups(organization_id,pipeline_entry_id,due_date,id)
  WHERE pipeline_entry_id IS NOT NULL AND completed_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_follow_ups_guided_business_completed
  ON public.follow_ups(organization_id,pipeline_entry_id,completed_at,id)
  WHERE pipeline_entry_id IS NOT NULL AND completed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guided_follow_up_result(
  p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_state text,p_date_operator text,p_date date
)
RETURNS TABLE(rule_id text,matched boolean,follow_up_id uuid,title text,event_date text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NULLIF(btrim(p_rule_id),'') IS NULL OR length(p_rule_id)>128
    OR p_relation NOT IN ('lead','trigger_business') OR p_state NOT IN ('pending','completed')
    OR p_date_operator NOT IN ('any','equals','not_equals','before','on_or_before','after','on_or_after')
    OR (p_date_operator='any' AND p_date IS NOT NULL) OR (p_date_operator<>'any' AND p_date IS NULL)
  THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;

  IF p_relation='trigger_business' THEN
    IF p_entry_id IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
    PERFORM 1 FROM public.pipeline_entries pe WHERE pe.id=p_entry_id AND pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  END IF;

  IF p_state='completed' AND EXISTS (
    SELECT 1 FROM public.follow_ups f WHERE f.organization_id=p_organization_id AND f.lead_id=p_lead_id
      AND (CASE WHEN p_relation='lead' THEN f.pipeline_entry_id IS NULL ELSE f.pipeline_entry_id=p_entry_id END)
      AND f.completed_at>statement_timestamp()
  ) THEN RAISE EXCEPTION 'source_unavailable' USING ERRCODE='22000'; END IF;

  RETURN QUERY WITH candidates AS (
    SELECT f.id,COALESCE(NULLIF(btrim(f.title),''),'Follow-up sem título') AS title,
      CASE WHEN p_state='pending' THEN to_char(f.due_date AT TIME ZONE o.timezone,'YYYY-MM-DD')
        ELSE to_char(f.completed_at AT TIME ZONE o.timezone,'YYYY-MM-DD') END AS local_date
    FROM public.follow_ups f JOIN public.organizations o ON o.id=p_organization_id
    WHERE f.organization_id=p_organization_id AND f.lead_id=p_lead_id
      AND (CASE WHEN p_relation='lead' THEN f.pipeline_entry_id IS NULL ELSE f.pipeline_entry_id=p_entry_id END)
      AND (CASE WHEN p_state='pending' THEN f.completed_at IS NULL AND f.archived_at IS NULL ELSE f.completed_at IS NOT NULL END)
  ), eligible AS (
    SELECT c.* FROM candidates c WHERE p_date_operator='any'
      OR (p_date_operator='equals' AND c.local_date=p_date::text)
      OR (p_date_operator='not_equals' AND c.local_date<>p_date::text)
      OR (p_date_operator='before' AND c.local_date<p_date::text)
      OR (p_date_operator='on_or_before' AND c.local_date<=p_date::text)
      OR (p_date_operator='after' AND c.local_date>p_date::text)
      OR (p_date_operator='on_or_after' AND c.local_date>=p_date::text)
  ), picked AS (SELECT e.* FROM eligible e ORDER BY e.local_date DESC,e.id DESC LIMIT 1)
  SELECT p_rule_id,p.id IS NOT NULL,p.id,p.title,p.local_date FROM (SELECT 1) seed LEFT JOIN picked p ON true;
END; $$;
REVOKE ALL ON FUNCTION public.guided_follow_up_result(uuid,uuid,uuid,text,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.test_guided_condition_follow_up(
  p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_state text,p_date_operator text,p_date date
)
RETURNS TABLE(rule_id text,matched boolean,follow_up_id uuid,title text,event_date text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL
    OR NOT COALESCE(public.has_feature_permission('followups.view',p_organization_id),false)
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.can_link_or_read_lead(p_lead_id,p_organization_id)
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN QUERY SELECT * FROM public.guided_follow_up_result(p_organization_id,p_lead_id,p_entry_id,p_rule_id,p_relation,p_state,p_date_operator,p_date);
END; $$;
REVOKE ALL ON FUNCTION public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_guided_condition_follow_up(
  p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_state text,p_date_operator text,p_date date
)
RETURNS TABLE(rule_id text,matched boolean,follow_up_id uuid,title text,event_date text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g ON g.workflow_id=w.id AND g.organization_id=w.organization_id
    WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads'
      AND ARRAY['activity.follow_up']::text[]<@g.fields AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN QUERY SELECT * FROM public.guided_follow_up_result(p_organization_id,p_lead_id,p_entry_id,p_rule_id,p_relation,p_state,p_date_operator,p_date);
END; $$;
REVOKE ALL ON FUNCTION public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date) TO service_role;

-- Historical values stay hidden as soon as the current user loses the
-- permission that exposes the underlying follow-ups in the product.
CREATE OR REPLACE FUNCTION public.can_read_guided_execution_data(
  p_organization_id uuid,
  p_lead_id uuid,
  p_version_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_fields text[];
  v_definition jsonb;
  v_box_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL OR p_lead_id IS NULL OR p_version_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_master_user() THEN
    RETURN public.can_administer_guided_workflow(p_organization_id);
  END IF;
  IF NOT public.can_link_or_read_lead(p_lead_id, p_organization_id) THEN
    RETURN false;
  END IF;

  SELECT v.required_fields, v.definition INTO v_required_fields, v_definition
  FROM public.workflow_guided_versions v
  WHERE v.id = p_version_id
    AND v.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'business.%')
    AND NOT COALESCE(public.has_feature_permission('pipeline.view', p_organization_id), false) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f = 'activity.follow_up')
    AND NOT COALESCE(public.has_feature_permission('followups.view', p_organization_id), false) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'message.%') THEN
    IF NOT COALESCE(public.has_feature_permission('whatsapp.view', p_organization_id), false)
      OR NOT public.can_see_chat_lead(p_organization_id, p_lead_id) THEN
      RETURN false;
    END IF;
    SELECT array_agg(DISTINCT (q.value #>> '{}')::uuid)
      INTO v_box_ids
    FROM jsonb_path_query(v_definition, '$.**.boxId') AS q(value)
    WHERE jsonb_typeof(q.value) = 'string';
    IF cardinality(COALESCE(v_box_ids, ARRAY[]::uuid[])) > 0
      AND NOT v_box_ids <@ public.whatsapp_readable_instance_ids(p_organization_id, v_box_ids) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.can_read_guided_execution_data(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_follow_up_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE
    condition->>'relation' NOT IN ('lead','trigger_business') OR condition->>'state' NOT IN ('pending','completed')
    OR condition->>'operator' NOT IN ('exists','not_exists')
    OR condition->>'dateOperator' NOT IN ('any','equals','not_equals','before','on_or_before','after','on_or_after')
    OR CASE WHEN condition->>'dateOperator'='any' THEN condition ? 'date'
      ELSE CASE WHEN (condition->>'date')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN NOT (
        substring(condition->>'date',1,4)::integer BETWEEN 1 AND 9999
        AND substring(condition->>'date',6,2)::integer BETWEEN 1 AND 12
        AND substring(condition->>'date',9,2)::integer BETWEEN 1 AND CASE substring(condition->>'date',6,2)::integer
          WHEN 2 THEN CASE WHEN substring(condition->>'date',1,4)::integer%400=0
            OR (substring(condition->>'date',1,4)::integer%4=0 AND substring(condition->>'date',1,4)::integer%100<>0) THEN 29 ELSE 28 END
          WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
      ELSE true END END)
  INTO v_invalid FROM conditions WHERE condition->>'field'='activity.follow_up';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT 1 FROM conditions WHERE condition->>'field'='activity.follow_up' AND NOT ('activity.follow_up'=ANY(NEW.required_fields)))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_guided_follow_up_version() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS validate_guided_follow_up_version ON public.workflow_guided_versions;
CREATE TRIGGER validate_guided_follow_up_version BEFORE INSERT OR UPDATE OF definition,required_fields ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_follow_up_version();

NOTIFY pgrst,'reload schema';
COMMIT;
