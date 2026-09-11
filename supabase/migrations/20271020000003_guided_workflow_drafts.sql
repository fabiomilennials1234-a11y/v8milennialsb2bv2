-- Explicit draft storage. Saving here never mutates the legacy/live definition
-- and never grants data access or publishes a version as a side effect.
CREATE TABLE IF NOT EXISTS public.workflow_guided_drafts (
  workflow_id uuid PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  revision integer NOT NULL CHECK (revision > 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_guided_drafts_organization_idx
  ON public.workflow_guided_drafts(organization_id);
ALTER TABLE public.workflow_guided_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workflow_guided_drafts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.workflow_guided_drafts TO authenticated, service_role;
DROP POLICY IF EXISTS workflow_guided_drafts_admin_read ON public.workflow_guided_drafts;
CREATE POLICY workflow_guided_drafts_admin_read ON public.workflow_guided_drafts
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()));

CREATE OR REPLACE FUNCTION public.save_guided_workflow_draft(
  p_workflow_id uuid, p_definition jsonb, p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_revision integer;
  v_saved public.workflow_guided_drafts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT w.organization_id INTO v_organization_id FROM public.workflows w
  WHERE w.id = p_workflow_id
    AND w.organization_id IN (SELECT public.get_my_admin_organization_ids())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_draft' USING ERRCODE = '22023';
  END IF;
  SELECT d.revision INTO v_revision FROM public.workflow_guided_drafts d
    WHERE d.workflow_id = p_workflow_id AND d.organization_id = v_organization_id;
  IF coalesce(v_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'draft_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.workflow_guided_drafts AS d
    (workflow_id, organization_id, definition, revision, updated_by)
  VALUES (p_workflow_id, v_organization_id, p_definition, coalesce(v_revision, 0) + 1, auth.uid())
  ON CONFLICT (workflow_id) DO UPDATE SET
    definition = EXCLUDED.definition, revision = EXCLUDED.revision,
    updated_by = EXCLUDED.updated_by, updated_at = now()
  WHERE d.organization_id = EXCLUDED.organization_id
  RETURNING * INTO v_saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('workflow_id', v_saved.workflow_id, 'revision', v_saved.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_guided_workflow_draft(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_guided_workflow_draft(uuid, jsonb, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
