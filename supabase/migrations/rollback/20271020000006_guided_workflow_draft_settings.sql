-- Preserve settings so rollback/reapply never discards user edits.
BEGIN;
DROP FUNCTION IF EXISTS public.save_guided_workflow_draft_with_settings(uuid, jsonb, integer, jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
