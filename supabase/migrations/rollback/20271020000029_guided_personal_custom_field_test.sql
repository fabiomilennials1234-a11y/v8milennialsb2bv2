-- Remove only the personal evaluation entry point; preserve definitions/answers.
BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_custom_fields(uuid,uuid,uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
