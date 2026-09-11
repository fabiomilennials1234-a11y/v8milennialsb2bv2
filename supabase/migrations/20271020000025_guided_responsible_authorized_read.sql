-- Add explicit origin access and atomic mixed reference reads.
-- Retain prior definitions so recovery never narrows stored approval history.
BEGIN;
ALTER TABLE public.workflow_data_grants DROP CONSTRAINT workflow_data_grants_fields_check;
ALTER TABLE public.workflow_data_grants ADD CONSTRAINT workflow_data_grants_fields_check CHECK (
  fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[] AND array_position(fields, NULL) IS NULL AND cardinality(fields) <= 14
);
CREATE OR REPLACE FUNCTION public.set_workflow_data_grant(
  p_workflow_id uuid, p_fields text[], p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_revision integer;
  v_grant public.workflow_data_grants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  -- Lock the parent, including the first approval when no grant row exists.
  -- Organization is resolved here, never accepted from the caller's payload.
  SELECT w.organization_id INTO v_organization_id
  FROM public.workflows w
  WHERE w.id = p_workflow_id
    AND public.can_administer_guided_workflow(w.organization_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[])
    OR array_position(p_fields, NULL) IS NOT NULL OR cardinality(p_fields) > 14
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT g.revision INTO v_revision FROM public.workflow_data_grants g
    WHERE g.workflow_id = p_workflow_id AND g.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'grant_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.workflow_data_grants AS g
    (workflow_id, organization_id, fields, revision, approved_by)
  VALUES (p_workflow_id, v_organization_id, p_fields, coalesce(v_revision, 0) + 1, auth.uid())
  ON CONFLICT (workflow_id) DO UPDATE SET
    fields = EXCLUDED.fields, revision = EXCLUDED.revision,
    approved_by = EXCLUDED.approved_by, updated_at = now()
  WHERE g.organization_id = EXCLUDED.organization_id
  RETURNING * INTO v_grant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('workflow_id', v_grant.workflow_id,
    'organization_id', v_grant.organization_id, 'resource_scope', v_grant.resource_scope,
    'fields', v_grant.fields, 'revision', v_grant.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.set_workflow_data_grant(uuid,text[],integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_workflow_data_grant(uuid,text[],integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.read_guided_condition_data(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[], p_tag_ids uuid[], p_origin_ids uuid[], p_member_ids uuid[]
) RETURNS TABLE(id uuid, organization_id uuid, field_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_organization_id uuid; v_tag_ids uuid[]; v_origin_ids uuid[]; v_member_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 14
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[])
    OR p_member_ids IS NULL OR array_position(p_member_ids, NULL) IS NOT NULL
    OR (cardinality(p_member_ids) > 0 AND NOT (p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[]))
    OR p_origin_ids IS NULL OR array_position(p_origin_ids, NULL) IS NOT NULL
    OR (cardinality(p_origin_ids) > 0 AND NOT ('lead.origin' = ANY(p_fields)))
    OR p_tag_ids IS NULL OR array_position(p_tag_ids, NULL) IS NOT NULL
    OR (('lead.tags' = ANY(p_fields)) IS DISTINCT FROM (cardinality(p_tag_ids) > 0)) THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT w.organization_id INTO v_organization_id
    FROM public.workflows w JOIN public.workflow_data_grants g
      ON g.workflow_id = w.id AND g.organization_id = w.organization_id
    WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id
      AND g.resource_scope = 'organization_leads' AND p_fields <@ g.fields
      AND NOT public.org_access_blocked(w.organization_id)
    FOR SHARE OF w, g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id = p_lead_id
    AND l.organization_id = v_organization_id AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_tag_ids
    FROM unnest(p_tag_ids) AS requested(id);
  IF cardinality(v_tag_ids) > 0 THEN
    -- Lock referenced catalogue rows so removal cannot race validation/read.
    PERFORM 1 FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id) <> cardinality(v_tag_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_origin_ids
    FROM unnest(p_origin_ids) AS requested(id);
  IF cardinality(v_origin_ids) > 0 THEN
    PERFORM 1 FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id) <> cardinality(v_origin_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_member_ids
    FROM unnest(p_member_ids) AS requested(id);
  IF cardinality(v_member_ids) > 0 THEN
    PERFORM 1 FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id AND NOT public.is_master_user(m.user_id)) <> cardinality(v_member_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  -- One statement projects scalar data and membership; no independently stale
  -- scalar/tag snapshots and no unrequested scalar values in the response.
  RETURN QUERY SELECT l.id, l.organization_id,
    (CASE WHEN 'lead.name' = ANY(p_fields) THEN jsonb_build_object('name', l.name) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.company' = ANY(p_fields) THEN jsonb_build_object('company', l.company) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.email' = ANY(p_fields) THEN jsonb_build_object('email', l.email) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.phone' = ANY(p_fields) THEN jsonb_build_object('phone', l.phone) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.qualification_score' = ANY(p_fields) THEN jsonb_build_object('qualification_score', l.qualification_score) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_campaign' = ANY(p_fields) THEN jsonb_build_object('utm_campaign', l.utm_campaign) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_source' = ANY(p_fields) THEN jsonb_build_object('utm_source', l.utm_source) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_medium' = ANY(p_fields) THEN jsonb_build_object('utm_medium', l.utm_medium) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_content' = ANY(p_fields) THEN jsonb_build_object('utm_content', l.utm_content) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_term' = ANY(p_fields) THEN jsonb_build_object('utm_term', l.utm_term) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.tags' = ANY(p_fields) THEN jsonb_build_object('tags', (
      SELECT jsonb_agg(jsonb_build_object('tag_id', t.id, 'tag_name', t.name, 'assigned', EXISTS (
        SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = t.id
      )) ORDER BY t.id) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = v_organization_id
    )) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.origin' = ANY(p_fields) THEN jsonb_build_object('origin',
      jsonb_build_object('actual_origin', l.origin, 'origins', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug) ORDER BY o.id), '[]'::jsonb)
        FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids) AND o.organization_id = v_organization_id
      ))) ELSE '{}'::jsonb END)
    || (CASE WHEN p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id']::text[] THEN jsonb_build_object('responsibles',
      jsonb_build_object('field_values',
        (CASE WHEN 'lead.pre_sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('pre_sale_responsible_id', l.pre_sale_responsible_id) ELSE '{}'::jsonb END)
        || (CASE WHEN 'lead.sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('sale_responsible_id', l.sale_responsible_id) ELSE '{}'::jsonb END),
        'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.id), '[]'::jsonb)
          FROM public.team_members m WHERE m.id = ANY(v_member_ids) AND m.organization_id = v_organization_id
            AND NOT public.is_master_user(m.user_id))
      )) ELSE '{}'::jsonb END)
    FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_organization_id AND l.deleted_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[],uuid[],uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
