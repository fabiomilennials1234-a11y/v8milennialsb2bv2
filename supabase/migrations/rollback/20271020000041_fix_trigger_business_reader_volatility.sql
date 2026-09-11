BEGIN;
ALTER FUNCTION public.read_guided_condition_trigger_business_stage(uuid,uuid,uuid,uuid,jsonb) STABLE;
COMMIT;
