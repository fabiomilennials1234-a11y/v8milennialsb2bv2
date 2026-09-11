-- Stop new guided creation; preserve every previously created shell and draft.
BEGIN;
DROP FUNCTION IF EXISTS public.create_guided_workflow_draft(uuid, uuid, text, jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
