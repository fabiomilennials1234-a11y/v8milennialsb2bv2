BEGIN;
DROP FUNCTION IF EXISTS public.test_guided_condition_trigger_business_stage(uuid,uuid,uuid,jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
