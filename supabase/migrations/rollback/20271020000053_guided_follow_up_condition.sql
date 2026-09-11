BEGIN;
DROP TRIGGER IF EXISTS validate_guided_follow_up_version ON public.workflow_guided_versions;
DROP FUNCTION IF EXISTS public.validate_guided_follow_up_version();
DROP FUNCTION IF EXISTS public.read_guided_condition_follow_up(uuid,uuid,uuid,uuid,text,text,text,text,date);
DROP FUNCTION IF EXISTS public.test_guided_condition_follow_up(uuid,uuid,uuid,text,text,text,text,date);
DROP FUNCTION IF EXISTS public.guided_follow_up_result(uuid,uuid,uuid,text,text,text,text,date);
DROP INDEX IF EXISTS public.idx_follow_ups_guided_lead_pending;
DROP INDEX IF EXISTS public.idx_follow_ups_guided_lead_completed;
DROP INDEX IF EXISTS public.idx_follow_ups_guided_business_pending;
DROP INDEX IF EXISTS public.idx_follow_ups_guided_business_completed;
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
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text','message.waiting.elapsed']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
