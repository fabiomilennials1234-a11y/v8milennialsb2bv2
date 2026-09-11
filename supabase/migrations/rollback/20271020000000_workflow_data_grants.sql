-- Feature rollback: make access unavailable without deleting approval history.
-- Stop guided execution before applying. Legacy workflows are unaffected.
-- Reapply the forward migration to restore the endpoint and read policy.
BEGIN;
DROP FUNCTION IF EXISTS public.set_workflow_data_grant(uuid, text[], integer);
DROP POLICY IF EXISTS workflow_data_grants_admin_read ON public.workflow_data_grants;
REVOKE ALL ON TABLE public.workflow_data_grants FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
