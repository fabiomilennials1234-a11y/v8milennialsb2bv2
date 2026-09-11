BEGIN;
DROP FUNCTION IF EXISTS public.create_guided_workflow_draft_with_settings(uuid, uuid, jsonb, jsonb);
-- Keep drafts, settings and inactive workflow shells intact.
NOTIFY pgrst, 'reload schema';
COMMIT;
