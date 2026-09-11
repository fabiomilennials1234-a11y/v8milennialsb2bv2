-- Remove the personal test capability; preserve all tag/reference data.
BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_tags(uuid,uuid,uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
