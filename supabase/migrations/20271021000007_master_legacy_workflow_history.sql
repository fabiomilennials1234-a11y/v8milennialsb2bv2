-- Full masters may inspect legacy executions without a guided snapshot.
-- Keep restricted masters and ordinary readers under existing authorization.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_read_guided_execution_data(
  p_organization_id uuid,p_lead_id uuid,p_version_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_required_fields text[]; v_definition jsonb; v_box_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL THEN RETURN false; END IF;
  IF public.is_master_user() THEN RETURN public.can_administer_guided_workflow(p_organization_id); END IF;
  IF p_lead_id IS NULL OR p_version_id IS NULL THEN RETURN false; END IF;
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
