BEGIN;
DROP TRIGGER IF EXISTS validate_guided_trigger_business_stage_version ON public.workflow_guided_versions;
DROP FUNCTION IF EXISTS public.validate_guided_trigger_business_stage_version();
DROP FUNCTION IF EXISTS public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields) <= 256
    AND coalesce(array_ndims(p_fields), 1) = 1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) AS requested(scope)
      WHERE scope IS NULL OR NOT (scope = ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[])
        OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
