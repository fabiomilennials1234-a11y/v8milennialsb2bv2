-- Validated versions are append-only through a service-only finalizer.
BEGIN;
CREATE TABLE IF NOT EXISTS public.workflow_guided_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  source_revision integer NOT NULL CHECK (source_revision > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  required_fields text[] NOT NULL,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version_number),
  UNIQUE (workflow_id, organization_id, id)
);
CREATE INDEX IF NOT EXISTS workflow_guided_versions_org_idx ON public.workflow_guided_versions(organization_id);
CREATE TABLE IF NOT EXISTS public.workflow_guided_publications (
  workflow_id uuid PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  FOREIGN KEY (workflow_id, organization_id, version_id)
    REFERENCES public.workflow_guided_versions(workflow_id, organization_id, id)
);
CREATE INDEX IF NOT EXISTS workflow_guided_publications_org_idx ON public.workflow_guided_publications(organization_id);
ALTER TABLE public.workflow_guided_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_guided_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_guided_versions, public.workflow_guided_publications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.workflow_guided_versions, public.workflow_guided_publications TO authenticated, service_role;
DROP POLICY IF EXISTS guided_versions_admin_read ON public.workflow_guided_versions;
CREATE POLICY guided_versions_admin_read ON public.workflow_guided_versions FOR SELECT TO authenticated
  USING (public.can_administer_guided_workflow(organization_id));
DROP POLICY IF EXISTS guided_publications_admin_read ON public.workflow_guided_publications;
CREATE POLICY guided_publications_admin_read ON public.workflow_guided_publications FOR SELECT TO authenticated
  USING (public.can_administer_guided_workflow(organization_id));

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
    OR NOT (p_required_fields <@ ARRAY['lead.name']::text[]) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_required_fields) > 0 THEN
    PERFORM 1 FROM public.workflow_data_grants g
      WHERE g.workflow_id = p_workflow_id AND g.organization_id = p_organization_id
        AND g.resource_scope = 'organization_leads' AND p_required_fields <@ g.fields FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
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
