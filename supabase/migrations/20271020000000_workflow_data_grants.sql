-- Explicit organizational access for guided workflows. No grants are seeded.
-- The resource scope is all live leads in this workflow's organization; the
-- approved fields remain an exact allowlist. An empty list revokes access.
CREATE TABLE IF NOT EXISTS public.workflow_data_grants (
  workflow_id uuid PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_scope text NOT NULL DEFAULT 'organization_leads'
    CHECK (resource_scope = 'organization_leads'),
  fields text[] NOT NULL CHECK (
    fields <@ ARRAY['lead.name']::text[]
    AND array_position(fields, NULL) IS NULL AND cardinality(fields) <= 1
  ),
  revision integer NOT NULL CHECK (revision > 0),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_data_grants_organization_idx
  ON public.workflow_data_grants(organization_id);
ALTER TABLE public.workflow_data_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workflow_data_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.workflow_data_grants TO authenticated, service_role;
DROP POLICY IF EXISTS workflow_data_grants_admin_read ON public.workflow_data_grants;
CREATE POLICY workflow_data_grants_admin_read ON public.workflow_data_grants
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));

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
    AND w.organization_id IN (SELECT public.get_my_admin_organization_ids())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR NOT (p_fields <@ ARRAY['lead.name']::text[])
    OR array_position(p_fields, NULL) IS NOT NULL OR cardinality(p_fields) > 1
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT g.revision INTO v_revision FROM public.workflow_data_grants g
    WHERE g.workflow_id = p_workflow_id AND g.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'grant_revision_conflict' USING ERRCODE = '40001';
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
REVOKE ALL ON FUNCTION public.set_workflow_data_grant(uuid, text[], integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_workflow_data_grant(uuid, text[], integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
