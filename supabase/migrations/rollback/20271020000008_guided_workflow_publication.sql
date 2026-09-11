-- Preserve versions and selected publication while disabling this capability.
BEGIN;
DROP FUNCTION IF EXISTS public.finalize_guided_workflow_publication(uuid, uuid, uuid, integer, jsonb, jsonb, text[]);
DROP POLICY IF EXISTS guided_versions_admin_read ON public.workflow_guided_versions;
DROP POLICY IF EXISTS guided_publications_admin_read ON public.workflow_guided_publications;
REVOKE ALL ON public.workflow_guided_versions, public.workflow_guided_publications FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
