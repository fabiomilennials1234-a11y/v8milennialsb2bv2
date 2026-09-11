-- Remove only the guided catalogue; preserve all member and assignment data.
BEGIN;
DROP VIEW IF EXISTS public.guided_responsible_members;
NOTIFY pgrst, 'reload schema';
COMMIT;
