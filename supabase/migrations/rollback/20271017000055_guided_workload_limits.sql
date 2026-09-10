BEGIN;

DROP TRIGGER IF EXISTS validate_guided_workload_version
  ON public.workflow_guided_versions;

DROP FUNCTION IF EXISTS public.validate_guided_workload_version();

NOTIFY pgrst, 'reload schema';

COMMIT;
