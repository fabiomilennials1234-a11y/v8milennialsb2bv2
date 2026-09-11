-- Resolve canonical assignments and requested member identities under caller RLS.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_responsibles(
  p_organization_id uuid, p_lead_id uuid, p_fields text[], p_member_ids uuid[]
) RETURNS TABLE(field_values jsonb, members jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_ids uuid[]; v_values jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 2
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[])
    OR p_member_ids IS NULL OR array_position(p_member_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  SELECT (CASE WHEN 'lead.pre_sale_responsible_id' = ANY(p_fields)
      THEN jsonb_build_object('pre_sale_responsible_id', l.pre_sale_responsible_id) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.sale_responsible_id' = ANY(p_fields)
      THEN jsonb_build_object('sale_responsible_id', l.sale_responsible_id) ELSE '{}'::jsonb END)
    INTO v_values FROM public.leads l
    WHERE l.id = p_lead_id AND l.organization_id = p_organization_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_ids
    FROM unnest(p_member_ids) AS requested(id);
  -- Preserve the existing visible-member catalogue. Check master status through
  -- its authoritative helper as master_users rows may be hidden by caller RLS.
  IF (SELECT count(*) FROM public.org_visible_members m WHERE m.organization_id = p_organization_id
    AND m.id = ANY(v_ids) AND NOT public.is_master_user(m.user_id)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT v_values, coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.id), '[]'::jsonb)
    FROM public.org_visible_members m WHERE m.organization_id = p_organization_id
      AND m.id = ANY(v_ids) AND NOT public.is_master_user(m.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
