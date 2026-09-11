-- Product criteria preserve business-item, manual-association and won-deal identities.
BEGIN;

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text','message.waiting.elapsed','activity.follow_up','product.trigger_business_item','product.lead_association','product.won_deal_history']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guided_product_relation_result(
  p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_product_id uuid
)
RETURNS TABLE(rule_id text,matched boolean,product_id uuid,product_name text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_product_name text; v_deal_id uuid; v_matched boolean := false;
BEGIN
  IF NULLIF(btrim(p_rule_id),'') IS NULL OR length(p_rule_id)>128
    OR p_relation NOT IN ('trigger_business_item','lead_association','won_deal_history') OR p_product_id IS NULL
  THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;

  SELECT p.name INTO v_product_name FROM public.products p
  WHERE p.id=p_product_id AND p.organization_id=p_organization_id AND p.is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'reference_unavailable' USING ERRCODE='PT422'; END IF;
  v_product_name := COALESCE(NULLIF(btrim(v_product_name),''),'Produto sem nome');

  IF p_relation='trigger_business_item' THEN
    IF p_entry_id IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
    SELECT pe.deal_id INTO v_deal_id FROM public.pipeline_entries pe
    WHERE pe.id=p_entry_id AND pe.organization_id=p_organization_id AND pe.lead_id=p_lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
    IF v_deal_id IS NOT NULL THEN
      PERFORM 1 FROM public.deals d WHERE d.id=v_deal_id AND d.organization_id=p_organization_id
        AND d.source_lead_id=p_lead_id AND d.deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
      SELECT EXISTS(SELECT 1 FROM public.deal_items di WHERE di.organization_id=p_organization_id
        AND di.deal_id=v_deal_id AND di.product_id=p_product_id) INTO v_matched;
    END IF;
  ELSIF p_relation='lead_association' THEN
    SELECT EXISTS(SELECT 1 FROM public.lead_products lp WHERE lp.organization_id=p_organization_id
      AND lp.lead_id=p_lead_id AND lp.product_id=p_product_id AND lp.source='manual' AND lp.status='active') INTO v_matched;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.lead_products lp WHERE lp.organization_id=p_organization_id
      AND lp.lead_id=p_lead_id AND lp.product_id=p_product_id AND lp.source='deal'
      AND lp.purchase_count>0 AND lp.last_purchased_at IS NOT NULL) INTO v_matched;
  END IF;
  RETURN QUERY SELECT p_rule_id,v_matched,p_product_id,v_product_name;
END; $$;
REVOKE ALL ON FUNCTION public.guided_product_relation_result(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.test_guided_condition_product_relation(
  p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_product_id uuid
)
RETURNS TABLE(rule_id text,matched boolean,product_id uuid,product_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_feature_permission('products.view',p_organization_id),false)
    OR (p_relation='trigger_business_item' AND NOT COALESCE(public.has_feature_permission('pipeline.view',p_organization_id),false))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.can_link_or_read_lead(p_lead_id,p_organization_id)
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN QUERY SELECT * FROM public.guided_product_relation_result(
    p_organization_id,p_lead_id,p_entry_id,p_rule_id,p_relation,p_product_id);
END; $$;
REVOKE ALL ON FUNCTION public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_product_relation(uuid,uuid,uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_guided_condition_product_relation(
  p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_entry_id uuid,p_rule_id text,p_relation text,p_product_id uuid
)
RETURNS TABLE(rule_id text,matched boolean,product_id uuid,product_name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_scope text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  v_scope := CASE p_relation
    WHEN 'trigger_business_item' THEN 'product.trigger_business_item'
    WHEN 'lead_association' THEN 'product.lead_association'
    WHEN 'won_deal_history' THEN 'product.won_deal_history'
    ELSE NULL END;
  IF v_scope IS NULL THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g
    ON g.workflow_id=w.id AND g.organization_id=w.organization_id
  WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads'
    AND ARRAY[v_scope]::text[]<@g.fields AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id
    AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN QUERY SELECT * FROM public.guided_product_relation_result(
    p_organization_id,p_lead_id,p_entry_id,p_rule_id,p_relation,p_product_id);
END; $$;
REVOKE ALL ON FUNCTION public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_product_relation(uuid,uuid,uuid,uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_product_relation_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[]; v_missing_scope text[]; v_missing_reference text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE
      condition->>'relation' NOT IN ('trigger_business_item','lead_association','won_deal_history')
      OR condition->>'operator' NOT IN ('has_product','not_has_product')
      OR jsonb_typeof(condition->'productId') IS DISTINCT FROM 'string'
      OR (condition->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE NOT (
      ('product.'||(condition->>'relation'))=ANY(NEW.required_fields))),
    array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE CASE
      WHEN (condition->>'productId')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=(condition->>'productId')::uuid
        AND p.organization_id=NEW.organization_id AND p.is_active=true) ELSE false END)
  INTO v_invalid,v_missing_scope,v_missing_reference FROM conditions WHERE condition->>'field'='product.relationship';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF cardinality(v_missing_scope)>0 THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF cardinality(v_missing_reference)>0 THEN RAISE EXCEPTION 'reference_unavailable' USING ERRCODE='PT422',DETAIL=jsonb_build_object('nodeIds',v_missing_reference)::text; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_guided_product_relation_version() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS validate_guided_product_relation_version ON public.workflow_guided_versions;
CREATE TRIGGER validate_guided_product_relation_version BEFORE INSERT OR UPDATE OF definition,required_fields ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_product_relation_version();

CREATE OR REPLACE FUNCTION public.can_read_guided_execution_data(
  p_organization_id uuid,p_lead_id uuid,p_version_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_required_fields text[]; v_definition jsonb; v_box_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL OR p_lead_id IS NULL OR p_version_id IS NULL THEN RETURN false; END IF;
  IF public.is_master_user() THEN RETURN public.can_administer_guided_workflow(p_organization_id); END IF;
  IF NOT public.can_link_or_read_lead(p_lead_id,p_organization_id) THEN RETURN false; END IF;
  SELECT v.required_fields,v.definition INTO v_required_fields,v_definition FROM public.workflow_guided_versions v
    WHERE v.id=p_version_id AND v.organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'business.%')
    AND NOT COALESCE(public.has_feature_permission('pipeline.view',p_organization_id),false) THEN RETURN false; END IF;
  IF 'product.trigger_business_item'=ANY(v_required_fields)
    AND NOT COALESCE(public.has_feature_permission('pipeline.view',p_organization_id),false) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'product.%')
    AND NOT COALESCE(public.has_feature_permission('products.view',p_organization_id),false) THEN RETURN false; END IF;
  IF 'activity.follow_up'=ANY(v_required_fields)
    AND NOT COALESCE(public.has_feature_permission('followups.view',p_organization_id),false) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'message.%') THEN
    IF NOT COALESCE(public.has_feature_permission('whatsapp.view',p_organization_id),false)
      OR NOT public.can_see_chat_lead(p_organization_id,p_lead_id) THEN RETURN false; END IF;
    SELECT array_agg(DISTINCT (q.value#>>'{}')::uuid) INTO v_box_ids
      FROM jsonb_path_query(v_definition,'$.**.boxId') q(value) WHERE jsonb_typeof(q.value)='string';
    IF cardinality(COALESCE(v_box_ids,ARRAY[]::uuid[]))>0
      AND NOT v_box_ids<@public.whatsapp_readable_instance_ids(p_organization_id,v_box_ids) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.can_read_guided_execution_data(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
