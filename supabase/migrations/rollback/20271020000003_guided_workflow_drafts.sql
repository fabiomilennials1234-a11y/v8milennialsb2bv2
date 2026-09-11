-- Disable draft editing while preserving every saved draft and revision.
BEGIN;
DROP FUNCTION IF EXISTS public.save_guided_workflow_draft(uuid, jsonb, integer);
DROP POLICY IF EXISTS workflow_guided_drafts_admin_read ON public.workflow_guided_drafts;
REVOKE ALL ON TABLE public.workflow_guided_drafts FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
