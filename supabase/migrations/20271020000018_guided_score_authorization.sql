-- Add explicit numeric qualification-score access without broadening existing grants.
-- Supersedes prior field definitions for recovery with retained six-field history.
BEGIN;
ALTER TABLE public.workflow_data_grants DROP CONSTRAINT workflow_data_grants_fields_check;
ALTER TABLE public.workflow_data_grants ADD CONSTRAINT workflow_data_grants_fields_check CHECK (
  fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.tags']::text[] AND array_position(fields, NULL) IS NULL AND cardinality(fields) <= 6
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
  IF p_fields IS NULL OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.tags']::text[])
    OR array_position(p_fields, NULL) IS NOT NULL OR cardinality(p_fields) > 6
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
CREATE OR REPLACE FUNCTION public.finalize_guided_workflow_publication(
  p_workflow_id uuid, p_organization_id uuid, p_actor_id uuid, p_expected_revision integer,
  p_definition jsonb, p_settings jsonb, p_required_fields text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_draft public.workflow_guided_drafts;
  v_version public.workflow_guided_versions;
  v_number integer;
  v_tag_ids uuid[];
  v_tag_references jsonb;
  v_invalid_node_ids text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id
    AND NOT public.org_access_blocked(o.id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;

  -- Actor comes from verified edge identity, not the browser request. Recheck
  -- current authority and hold the row until publication commits.
  SELECT true INTO v_authorized FROM public.team_members t
    WHERE t.user_id = p_actor_id AND t.organization_id = p_organization_id
      AND t.role = 'admin' AND t.is_active = true FOR SHARE;
  IF NOT coalesce(v_authorized, false) THEN
    SELECT true INTO v_authorized FROM public.master_users m
      WHERE m.user_id = p_actor_id AND m.is_active = true
        AND m.permissions -> 'all' = 'true'::jsonb FOR SHARE;
  END IF;
  IF NOT coalesce(v_authorized, false) THEN
    SELECT true INTO v_authorized FROM public.gestores g
      JOIN public.gestor_organizations go ON go.gestor_id = g.id
      WHERE g.user_id = p_actor_id AND g.is_active = true AND go.organization_id = p_organization_id
      FOR SHARE OF g, go;
  END IF;
  IF NOT coalesce(v_authorized, false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workflows w
    WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM public.workflow_guided_drafts d
    WHERE d.workflow_id = p_workflow_id AND d.organization_id = p_organization_id;
  IF NOT FOUND OR v_draft.revision IS DISTINCT FROM p_expected_revision
    OR v_draft.definition IS DISTINCT FROM p_definition OR v_draft.settings IS DISTINCT FROM p_settings THEN
    RAISE EXCEPTION 'draft_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings -> 'name') IS DISTINCT FROM 'string'
    OR btrim(p_settings ->> 'name') = ''
    OR p_required_fields IS NULL OR array_position(p_required_fields, NULL) IS NOT NULL
    OR NOT (p_required_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.tags']::text[]) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_required_fields) > 0 THEN
    PERFORM 1 FROM public.workflow_data_grants g
      WHERE g.workflow_id = p_workflow_id AND g.organization_id = p_organization_id
        AND g.resource_scope = 'organization_leads' AND p_required_fields <@ g.fields FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  END IF;
  -- Walk every rule, including branches the evaluator may later skip. Names
  -- supplied by the draft are display hints and never authorize an identity.
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'tagId', condition ->> 'tagId')), '[]'::jsonb)
    INTO v_tag_references FROM conditions WHERE condition ->> 'field' = 'lead.tags';
  SELECT coalesce(array_agg(DISTINCT (r ->> 'tagId')::uuid), '{}'::uuid[]) INTO v_tag_ids
    FROM jsonb_array_elements(v_tag_references) AS r;
  IF cardinality(v_tag_ids) > 0 THEN
    IF NOT ('lead.tags' = ANY(p_required_fields)) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_tag_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_tag_ids)) <> cardinality(v_tag_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_tag_references) AS r WHERE NOT EXISTS (
          SELECT 1 FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = (r ->> 'tagId')::uuid
        );
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  SELECT coalesce(max(v.version_number), 0) + 1 INTO v_number
    FROM public.workflow_guided_versions v WHERE v.workflow_id = p_workflow_id AND v.organization_id = p_organization_id;
  INSERT INTO public.workflow_guided_versions(workflow_id, organization_id, version_number, source_revision,
    definition, settings, required_fields, published_by)
  VALUES (p_workflow_id, p_organization_id, v_number, p_expected_revision, p_definition, p_settings, p_required_fields, p_actor_id)
  RETURNING * INTO v_version;
  INSERT INTO public.workflow_guided_publications AS p (workflow_id, organization_id, version_id)
  VALUES (p_workflow_id, p_organization_id, v_version.id)
  ON CONFLICT (workflow_id) DO UPDATE SET version_id = EXCLUDED.version_id
    WHERE p.organization_id = EXCLUDED.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('version_id', v_version.id, 'version_number', v_version.version_number);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_guided_workflow_publication(uuid, uuid, uuid, integer, jsonb, jsonb, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_guided_workflow_publication(uuid, uuid, uuid, integer, jsonb, jsonb, text[]) TO service_role;
CREATE OR REPLACE FUNCTION public.read_guided_condition_lead_fields(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[]
) RETURNS TABLE(id uuid, organization_id uuid, field_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_organization_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 5
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score']::text[]) THEN
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
  -- Exact projection: an approval for company never returns the lead's name.
  -- The grant's SHARE lock covers the data read in this same transaction.
  RETURN QUERY SELECT l.id, l.organization_id,
    (CASE WHEN 'lead.name' = ANY(p_fields) THEN jsonb_build_object('name', l.name) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.company' = ANY(p_fields) THEN jsonb_build_object('company', l.company) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.email' = ANY(p_fields) THEN jsonb_build_object('email', l.email) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.phone' = ANY(p_fields) THEN jsonb_build_object('phone', l.phone) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.qualification_score' = ANY(p_fields) THEN jsonb_build_object('qualification_score', l.qualification_score) ELSE '{}'::jsonb END)
  FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_organization_id AND l.deleted_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_lead_fields(uuid,uuid,uuid,text[]) TO service_role;
CREATE OR REPLACE FUNCTION public.read_guided_condition_data(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[], p_tag_ids uuid[]
) RETURNS TABLE(id uuid, organization_id uuid, field_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_organization_id uuid; v_tag_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 6
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.tags']::text[])
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
  -- One statement projects scalar data and membership; no independently stale
  -- scalar/tag snapshots and no unrequested scalar values in the response.
  RETURN QUERY SELECT l.id, l.organization_id,
    (CASE WHEN 'lead.name' = ANY(p_fields) THEN jsonb_build_object('name', l.name) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.company' = ANY(p_fields) THEN jsonb_build_object('company', l.company) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.email' = ANY(p_fields) THEN jsonb_build_object('email', l.email) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.phone' = ANY(p_fields) THEN jsonb_build_object('phone', l.phone) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.qualification_score' = ANY(p_fields) THEN jsonb_build_object('qualification_score', l.qualification_score) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.tags' = ANY(p_fields) THEN jsonb_build_object('tags', (
      SELECT jsonb_agg(jsonb_build_object('tag_id', t.id, 'tag_name', t.name, 'assigned', EXISTS (
        SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = t.id
      )) ORDER BY t.id) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = v_organization_id
    )) ELSE '{}'::jsonb END)
    FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_organization_id AND l.deleted_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_data(uuid,uuid,uuid,text[],uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
