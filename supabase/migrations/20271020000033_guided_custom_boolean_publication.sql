-- Authorize and publish current custom text/number/boolean definitions by UUID.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_workflow_data_grant(
  p_workflow_id uuid, p_fields text[], p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_revision integer;
  v_previous_fields text[];
  v_new_custom_ids uuid[];
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
  IF NOT public.valid_guided_data_scopes(p_fields)
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT g.revision, g.fields INTO v_revision, v_previous_fields FROM public.workflow_data_grants g
    WHERE g.workflow_id = p_workflow_id AND g.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'grant_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  -- Only new approvals need live definitions. Keeping/removing a prior scope
  -- must remain possible after its definition has been deleted or changed type.
  SELECT coalesce(array_agg(DISTINCT substr(scope, 13)::uuid), '{}'::uuid[]) INTO v_new_custom_ids
    FROM unnest(p_fields) AS requested(scope)
    WHERE scope LIKE 'lead.custom:%' AND NOT (scope = ANY(coalesce(v_previous_fields, '{}'::text[])));
  PERFORM 1 FROM public.lead_custom_fields f WHERE f.id = ANY(v_new_custom_ids)
    AND f.organization_id = v_organization_id AND f.field_type IN ('text', 'number', 'boolean') FOR SHARE;
  IF (SELECT count(*) FROM public.lead_custom_fields f WHERE f.id = ANY(v_new_custom_ids)
    AND f.organization_id = v_organization_id AND f.field_type IN ('text', 'number', 'boolean')) <> cardinality(v_new_custom_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
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
  v_origin_ids uuid[];
  v_origin_references jsonb;
  v_invalid_node_ids text[];
  v_member_ids uuid[];
  v_member_references jsonb;
  v_custom_references jsonb;
  v_custom_ids uuid[];
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
    OR NOT public.valid_guided_data_scopes(p_required_fields) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  -- Every custom rule refers to a definition, including empty/filled checks.
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id,
      'fieldId', condition ->> 'fieldId', 'fieldType', condition ->> 'fieldType')), '[]'::jsonb)
    INTO v_custom_references FROM conditions WHERE condition ->> 'field' = 'lead.custom';
  IF jsonb_array_length(v_custom_references) > 0 THEN
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_custom_references) AS r
      WHERE r ->> 'fieldId' IS NULL OR r ->> 'fieldId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR coalesce(r ->> 'fieldType', '') NOT IN ('text', 'number', 'boolean');
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_custom_references) AS r
      WHERE NOT (('lead.custom:' || lower(r ->> 'fieldId')) = ANY(p_required_fields))) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(DISTINCT (r ->> 'fieldId')::uuid), '{}'::uuid[]) INTO v_custom_ids
      FROM jsonb_array_elements(v_custom_references) AS r;
    PERFORM 1 FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
      AND f.id = ANY(v_custom_ids) FOR SHARE;
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_custom_references) AS r WHERE NOT EXISTS (
        SELECT 1 FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
          AND f.id = (r ->> 'fieldId')::uuid AND f.field_type = r ->> 'fieldType'
      );
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
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
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'originId', CASE WHEN condition ->> 'operator' IN ('is_empty', 'is_not_empty') THEN NULL ELSE condition ->> 'originId' END)), '[]'::jsonb)
    INTO v_origin_references FROM conditions WHERE condition ->> 'field' = 'lead.origin';
  SELECT coalesce(array_agg(DISTINCT (r ->> 'originId')::uuid), '{}'::uuid[]) INTO v_origin_ids
    FROM jsonb_array_elements(v_origin_references) AS r WHERE r ->> 'originId' IS NOT NULL;
  IF jsonb_array_length(v_origin_references) > 0 THEN
    IF NOT ('lead.origin' = ANY(p_required_fields)) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_origin_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_origin_ids)) <> cardinality(v_origin_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_origin_references) AS r WHERE r ->> 'originId' IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = (r ->> 'originId')::uuid
        );
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'field', condition ->> 'field',
      'requiresReference', coalesce(condition ->> 'operator', '') NOT IN ('is_empty', 'is_not_empty'),
      'memberId', CASE WHEN condition ->> 'operator' IN ('is_empty', 'is_not_empty') THEN NULL ELSE condition ->> 'memberId' END)), '[]'::jsonb)
    INTO v_member_references FROM conditions
    WHERE condition ->> 'field' IN ('lead.pre_sale_responsible_id', 'lead.sale_responsible_id');
  IF jsonb_array_length(v_member_references) > 0 THEN
    -- Empty checks also read an assignment and require that exact slot's scope.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_member_references) AS r
      WHERE NOT ((r ->> 'field') = ANY(p_required_fields))) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_member_references) AS r
      WHERE r ->> 'requiresReference' = 'true' AND (r ->> 'memberId' IS NULL
        OR r ->> 'memberId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
    SELECT coalesce(array_agg(DISTINCT (r ->> 'memberId')::uuid), '{}'::uuid[]) INTO v_member_ids
      FROM jsonb_array_elements(v_member_references) AS r WHERE r ->> 'memberId' IS NOT NULL;
    PERFORM 1 FROM public.team_members m WHERE m.organization_id = p_organization_id AND m.id = ANY(v_member_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.team_members m WHERE m.organization_id = p_organization_id
      AND m.id = ANY(v_member_ids) AND NOT public.is_master_user(m.user_id)) <> cardinality(v_member_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_member_references) AS r WHERE r ->> 'memberId' IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.team_members m WHERE m.organization_id = p_organization_id
            AND m.id = (r ->> 'memberId')::uuid AND NOT public.is_master_user(m.user_id)
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
NOTIFY pgrst, 'reload schema';
COMMIT;
