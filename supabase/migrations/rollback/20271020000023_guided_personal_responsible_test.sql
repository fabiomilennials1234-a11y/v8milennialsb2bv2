-- Remove the personal test entry point without modifying assignments or members.
BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_responsibles(uuid,uuid,text[],uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
