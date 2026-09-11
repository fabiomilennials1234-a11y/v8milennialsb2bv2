-- Remove only the personal origin reader. Preserve all catalogue/lead/workflow data.
BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_origins(uuid,uuid,uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
