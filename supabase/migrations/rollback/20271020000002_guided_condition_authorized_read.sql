-- Stop guided execution before reverting. Existing approval history remains.
BEGIN;
DROP FUNCTION IF EXISTS public.read_guided_condition_lead(uuid, uuid, uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;
