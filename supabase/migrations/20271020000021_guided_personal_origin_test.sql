-- Resolve origin references and the current lead code in one caller-RLS snapshot.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_origins(
  p_organization_id uuid, p_lead_id uuid, p_origin_ids uuid[]
) RETURNS TABLE(actual_origin text, origins jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_actual text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_origin_ids IS NULL OR array_position(p_origin_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  SELECT l.origin INTO v_actual FROM public.leads l
    WHERE l.id = p_lead_id AND l.organization_id = p_organization_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(p_origin_ids) AS requested(id);
  IF (SELECT count(*) FROM public.lead_origins o WHERE o.id = ANY(v_ids) AND o.organization_id = p_organization_id) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  -- Inactive origins remain valid historical classifications; deletion removes identity.
  RETURN QUERY SELECT v_actual, coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug) ORDER BY o.id), '[]'::jsonb)
    FROM public.lead_origins o WHERE o.id = ANY(v_ids) AND o.organization_id = p_organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_origins(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_origins(uuid,uuid,uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
