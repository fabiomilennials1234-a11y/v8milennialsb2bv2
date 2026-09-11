-- Preserve pins and their integrity. Disable only automatic capture for new rows.
-- Stop guided execution admission before rollback; older pinned runs need their
-- version-aware executor until drained. Never clear historical pins.
BEGIN;
DROP TRIGGER IF EXISTS pin_guided_execution_version ON public.workflow_executions;
CREATE TRIGGER pin_guided_execution_version BEFORE UPDATE OF guided_version_id, workflow_id, organization_id
  ON public.workflow_executions FOR EACH ROW EXECUTE FUNCTION public.pin_guided_execution_version();
REVOKE ALL ON FUNCTION public.pin_guided_execution_version() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
