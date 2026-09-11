-- Preserve definitions and answers; disable only the new personal options reader.
BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_custom_options(uuid,uuid,uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
