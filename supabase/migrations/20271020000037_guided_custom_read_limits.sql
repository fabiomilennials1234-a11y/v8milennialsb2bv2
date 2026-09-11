-- Bound personal custom-field requests consistently with the guided evaluator.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_custom_fields(
  p_organization_id uuid, p_lead_id uuid, p_field_ids uuid[]
) RETURNS TABLE(id uuid, name text, field_type text, value text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_field_ids IS NULL OR cardinality(p_field_ids) = 0 OR cardinality(p_field_ids) > 256 OR array_position(p_field_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id
    AND l.organization_id = p_organization_id AND l.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404';
  END IF;
  SELECT array_agg(DISTINCT requested.id) INTO v_ids FROM unnest(p_field_ids) AS requested(id);
  IF (SELECT count(*) FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
    AND f.id = ANY(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT f.id, f.field_name::text, f.field_type::text, v.value
    FROM public.lead_custom_fields f
    LEFT JOIN public.lead_custom_field_values v ON v.field_id = f.id AND v.lead_id = p_lead_id
    WHERE f.organization_id = p_organization_id AND f.id = ANY(v_ids)
    ORDER BY f.id;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_custom_fields(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_custom_fields(uuid,uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.test_guided_condition_custom_options(
  p_organization_id uuid, p_lead_id uuid, p_field_ids uuid[]
) RETURNS TABLE(id uuid, name text, field_type text, value text, field_options jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_field_ids IS NULL OR cardinality(p_field_ids) = 0 OR cardinality(p_field_ids) > 256 OR array_position(p_field_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id
    AND l.organization_id = p_organization_id AND l.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404';
  END IF;
  SELECT array_agg(DISTINCT requested.id) INTO v_ids FROM unnest(p_field_ids) AS requested(id);
  IF (SELECT count(*) FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
    AND f.id = ANY(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT f.id, f.field_name::text, f.field_type::text, v.value, f.field_options
    FROM public.lead_custom_fields f
    LEFT JOIN public.lead_custom_field_values v ON v.field_id = f.id AND v.lead_id = p_lead_id
    WHERE f.organization_id = p_organization_id AND f.id = ANY(v_ids)
    ORDER BY f.id;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_custom_options(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_custom_options(uuid,uuid,uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
