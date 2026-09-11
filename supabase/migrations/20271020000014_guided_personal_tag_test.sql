-- Evaluate reference validity and membership in one caller-RLS snapshot.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_tags(
  p_organization_id uuid, p_lead_id uuid, p_tag_ids uuid[]
) RETURNS TABLE(tag_id uuid, tag_name text, assigned boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_tag_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0 OR array_position(p_tag_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.leads l
    WHERE l.id = p_lead_id AND l.organization_id = p_organization_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT array_agg(DISTINCT requested.id) INTO v_tag_ids FROM unnest(p_tag_ids) AS requested(id);
  IF (SELECT count(*) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = p_organization_id) <> cardinality(v_tag_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT t.id, t.name, EXISTS (
    SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id = p_lead_id AND lt.tag_id = t.id
  ) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = p_organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_tags(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_tags(uuid,uuid,uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
